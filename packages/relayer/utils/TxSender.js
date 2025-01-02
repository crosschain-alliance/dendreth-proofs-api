// consume tx_to_send_queue
// fetch proof result from redis
// simulate the contract
// TODO: batching txs

import amqp from 'amqplib'
import 'dotenv/config'
import redisClient from './redisClient.js'
import logger from './Logger.js'
import { parseAbiItem } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export default class TxSender {
  consumeQueueName
  amqpConnection
  targetClient
  logger

  constructor(_configs) {
    this.consumeQueueName = _configs.consumeQueueName
    this.targetClient = _configs.targetClient
    this.logger = _configs.logger.child({ service: _configs.service })
  }

  async start() {
    this.amqpConnection = await amqp.connect(process.env.RABBITMQ_URL)

    const channel = await this.amqpConnection.createChannel()

    await channel.assertQueue(this.consumeQueueName, { durable: true })
    await channel.prefetch(1)

    channel.consume(this.consumeQueueName, async (msg) => {
      let txHash = msg.content.toString()
      this.logger.info(`Fetching proof from redis with tx hash ${txHash}`)

      const txHashResult = JSON.parse(await redisClient.get(txHash))

      try {
        // TODO: replace with actual function parameter
        let { request } = await this.targetClient.simulateContract({
          account: privateKeyToAccount(process.env.PRIVATE_KEY),
          abi: [
            parseAbiItem(
              'function verifyAndStoreDispatchedMessage(uint64 txSlot,bytes32[] memory receiptsRootProof,bytes32 receiptsRoot,bytes[] memory receiptProof,bytes memory txIndexRLPEncoded,uint256 logIndex) external'
            )
          ],
          functionName: 'verifyAndStoreDispatchedMessage',
          address: process.env.DENDRETH_ADAPTER_ADDRESS,
          args: txHashResult.proof
        })
        this.logger.info('Calling verifyAndStoreDispatchMessage with proof...')

        let tx = await this.targetClient.writeContract(request)
        this.logger.info(
          `Event proof for tx ${txHash} successfully verified on ${this.targetClient.chain.name}: tx hash ${tx}`
        )
      } catch (err) {
        this.logger.error('Err from TxSender ', err)
      }

      channel.ack(msg)
    })
  }
}
