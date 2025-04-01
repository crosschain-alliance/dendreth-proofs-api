import dotenv from 'dotenv'
dotenv.config()
import { createWalletClient, http, publicActions } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as chains from 'viem/chains'

import EventListener from './utils/EventListener.js'
import ProofProcessor from './utils/ProofProcessor.js'
import TxSender from './utils/TxSender.js'
import YahoABI from './ABI/YahoABI.js'
import YaruABI from './ABI/YaruABI.js'
import DendrETHAdapterABI from './ABI/DendrETHAdapterABI.js'
import HeliosAdapterABI from './ABI/HeliosAdapterABI.js'
import HeliosLightClientABI from './ABI/HeliosLightClientABI.js'
import logger from './utils/Logger.js'
import redisClient from './utils/redisClient.js'
import { createConnectionToQueue } from './utils/amqpClient.js'
import { isValidLightClientType } from './utils/utils.js'

// Graceful shutdown handler
let services = []
async function gracefulShutdown() {
  logger.info('Shutting down services gracefully...')
  for (const service of services) {
    if (service && typeof service.stop === 'function') {
      try {
        await service.stop()
      } catch (err) {
        logger.error(`Error stopping service: ${err}`)
      }
    }
  }

  // Close Redis connection
  try {
    await redisClient.quit()
  } catch (err) {
    logger.error(`Error closing Redis connection: ${err}`)
  }

  logger.info('All services stopped. Exiting...')
  process.exit(0)
}

async function main() {
  try {
    const sourceChain = Object.values(chains).find(({ id }) => id.toString() === process.env.SOURCE_CHAIN_ID)
    if (!sourceChain) throw new Error('Invalid SOURCE_CHAIN_ID')
    const targetChain = Object.values(chains).find(({ id }) => id.toString() === process.env.TARGET_CHAIN_ID)
    if (!targetChain) throw new Error('Invalid TARGET_CHAIN_ID')

    const sourceClient = createWalletClient({
      account: privateKeyToAccount(process.env.PRIVATE_KEY),
      chain: sourceChain,
      transport: http(process.env.SOURCE_RPC ? process.env.SOURCE_RPC : '')
    }).extend(publicActions)

    const targetClient = createWalletClient({
      account: privateKeyToAccount(process.env.PRIVATE_KEY),
      chain: targetChain,
      transport: http(process.env.TARGET_RPC ? process.env.TARGET_RPC : '')
    }).extend(publicActions)

    let relayerMessageDispatchEventQueue
    let txSenderQueue

    await createConnectionToQueue({
      queueName: `message_dispatch_event_queue_${sourceClient.chain.id}_${targetClient.chain.id}`,
      callback: ({ sendToQueue }) => {
        relayerMessageDispatchEventQueue = sendToQueue
      }
    })

    await createConnectionToQueue({
      queueName: `tx_to_send_queue_${sourceClient.chain.id}_${targetClient.chain.id}`,
      callback: ({ sendToQueue }) => {
        txSenderQueue = sendToQueue
      }
    })

    // Connect to Redis
    await redisClient.connect()
    logger.info('Redis connected successfully')

    if (!isValidLightClientType(process.env.LC_TYPE)) {
      throw Error('Light client is not supported')
    }

    const eventListener = new EventListener({
      logger,
      lightClientType: process.env.LC_TYPE,
      YahoABI,
      lightClientAdapterABI: process.env.LC_TYPE == 'dendreth' ? DendrETHAdapterABI : HeliosLightClientABI,
      sourceClient,
      targetClient,
      yahoContractAddress: process.env.SOURCE_YAHO_ADDRESS,
      lightClientContractAddress:
        process.env.LC_TYPE == 'dendreth' ? process.env.LIGHT_CLIENT_ADAPTER_ADDRESS : process.env.LIGHT_CLIENT_ADDRESS,
      service: 'EventListener',
      watchIntervalTimeMs: Number(process.env.WATCH_INTERVAL_TIME_MS),
      maxBlockWindow: Number(process.env.MAX_BLOCK_WINDOW),
      maxEventToProve: Number(process.env.MAX_EVENT_TO_PROVE),
      queryFromBlock: Number(process.env.INITIAL_QUERY_FROM_BLOCK),
      proverURL: process.env.PROOF_API,
      sendToMessageDispatchEventQueue: relayerMessageDispatchEventQueue,

      onLogs: async (_logs, logger, sendToMessageDispatchEventQueue) => {
        for (let i = 0; i < _logs.length; i++) {
          try {
            let txHash = _logs[i].transactionHash
            logger.info(
              `Getting receipt proof for event no.${i}, with tx hash ${txHash} on ${sourceClient.chain.name}...`
            )

            sendToMessageDispatchEventQueue(Buffer.from(txHash))
            logger.info(`Successfully sent ${txHash} to event dispatch queue`)
          } catch (error) {
            logger.error(error)
          }
        }
      }
    })

    const proofProcessor = new ProofProcessor({
      consumeQueueName: `message_dispatch_event_queue_${sourceClient.chain.id}_${targetClient.chain.id}`,
      publishQueueName: `tx_to_send_queue_${sourceClient.chain.id}_${targetClient.chain.id}`,
      logger,
      service: 'ProofProcessor',
      sendToTxSenderQueue: txSenderQueue
    })

    const txSender = new TxSender({
      consumeQueueName: `tx_to_send_queue_${sourceClient.chain.id}_${targetClient.chain.id}`,
      sourceClient,
      targetClient,
      isCallYaruExecuteMessages: process.env.IS_CALL_YARU_EXECUTE_MESSAGES,
      lightClientType: process.env.LC_TYPE,
      lightClientAdapterABI: process.env.LC_TYPE == 'dendreth' ? DendrETHAdapterABI : HeliosAdapterABI,
      lightClientAdapterContractAddress: process.env.LIGHT_CLIENT_ADAPTER_ADDRESS,
      yaruABI: YaruABI,
      yaruAddress: process.env.YARU_ADDRESS,
      yahoABI: YahoABI,
      service: 'TxSender',
      logger
    })

    // Store services for graceful shutdown
    services = [eventListener, proofProcessor, txSender]

    // Start all services in parallel
    await Promise.all([eventListener.start(), proofProcessor.start(), txSender.start()])

    logger.info('All services started successfully')

    // Set up signal handlers for graceful shutdown
    process.on('SIGTERM', gracefulShutdown)
    process.on('SIGINT', gracefulShutdown)
  } catch (error) {
    logger.error(`Fatal error in main: ${error}`)
    process.exit(1)
  }
}

main().catch((err) => {
  logger.error(`Unhandled error in main: ${err}`)
  process.exit(1)
})
