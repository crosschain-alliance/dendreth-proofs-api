import axios from 'axios'
import dotenv from 'dotenv'
dotenv.config()
import Relayer from './utils/Relayer.js'
import YahoABI from './utils/YahoABI.js'
import DendrETHAdapterABI from './utils/DendrETHAdapterABI.js'
import logger from './utils/Logger.js'
import { createWalletClient, http, publicActions } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as chains from 'viem/chains'

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

// 1. Watch for Hash Stored event on DendrETH Adapter with store block header function call
//  (no direct way to check the call, but we can check the HashStored event's id if it is a block number)
// 2. Once get the block number in HashStored, we query the Yaho event from blockNum - maxBlockWindow  to blockNum
// 3. Get the events and prove
const relayer = new Relayer({
  YahoABI,
  DendrETHAdapterABI,
  sourceClient,
  targetClient,
  yahoContractAddress: process.env.SOURCE_YAHO_ADDRESS,
  dendrethContractAddress: process.env.DENDRETH_ADAPTER_ADDRESS,
  logger,
  service: 'DendrETHRelayer',
  watchIntervalTimeMs: Number(process.env.WATCH_INTERVAL_TIME_MS),
  maxBlockWindow: Number(process.env.MAX_BLOCK_WINDOW),
  maxEventToProve: Number(process.env.MAX_EVENT_TO_PROVE),
  queryFromBlock: Number(process.env.INITIAL_QUERY_FROM_BLOCK),

  onLogs: async (_logs, logger) => {
    // request proof from API
    logger.info(`Processing ${_logs.length} MessageDispatched events`)
    for (let i = 0; i < _logs.length; i++) {
      try {
        let txHash = _logs[i].transactionHash
        logger.info(`Getting receipt proof for event no.${i}, with tx hash ${txHash} on ${sourceClient.chain.name}...`)
        let { data: proof } = await axios.get(`${process.env.PROOF_API}/${txHash}`)

        let { request } = await targetClient.simulateContract({
          account: privateKeyToAccount(process.env.PRIVATE_KEY),
          abi: DendrETHAdapterABI,
          functionName: 'verifyAndStoreDispatchedMessage',
          address: process.env.DENDRETH_ADAPTER_ADDRESS,
          args: proof.proof
        })
        logger.info('Calling verifyAndStoreDispatchMessage with proof...')

        let tx = await targetClient.writeContract(request)
        logger.info(`Event proof for tx ${txHash} successfully verified on ${targetClient.chain.name}: tx hash ${tx}`)
      } catch (error) {
        logger.error(error)
      }
    }

    logger.info(`All events successfully processed`)
  }
})

relayer.start()
