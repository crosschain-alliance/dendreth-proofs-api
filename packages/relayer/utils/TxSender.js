import amqp from 'amqplib'
import 'dotenv/config'
import { parseAbiItem } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import redisClient from './redisClient.js'

// 1. consume tx_to_send_queue
// 2. send proof to contract
// TODO: batching txs
export default class TxSender {
  consumeQueueName
  amqpConnection
  targetClient
  lightClientType
  lightClientAdapterABI
  lightClientAdapterContractAddress
  logger

  constructor(_configs) {
    this.consumeQueueName = _configs.consumeQueueName
    this.targetClient = _configs.targetClient
    this.logger = _configs.logger.child({ service: _configs.service })
    this.lightClientType = _configs.lightClientType
    this.lightClientAdapterABI = _configs.lightClientAdapterABI
    this.lightClientAdapterContractAddress = _configs.lightClientAdapterContractAddress
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
        let { request } = await this.targetClient.simulateContract({
          account: privateKeyToAccount(process.env.PRIVATE_KEY),
          abi:
            this.lightClientType == 'dendreth'
              ? [
                  parseAbiItem(
                    'function verifyAndStoreDispatchedMessage(bytes32 srcFinalizedHeader, uint64 srcSlot, bytes32[] calldata slotProof,uint64 txSlot,bytes32[] memory receiptsRootProof,bytes32 receiptsRoot,bytes[] memory receiptProof,bytes memory txIndexRLPEncoded,uint256 logIndex) external'
                  )
                ]
              : [
                  parseAbiItem(
                    'function verifyAndStoreDispatchedMessage(uint256 headerSlot, uint256 txSlot, bytes32[] memory receiptsRootProof, bytes32 receiptsRoot, bytes[] memory receiptProof, bytes memory txIndexRLPEncoded, uint256 logIndex) external'
                  )
                ],
          functionName: 'verifyAndStoreDispatchedMessage',
          address: this.lightClientAdapterContractAddress,
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
