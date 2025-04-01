import amqp from 'amqplib'
import 'dotenv/config'
import { parseAbiItem, decodeEventLog } from 'viem'
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
  yahoABI
  yaruABI
  yaruAddress
  isCallYaruExecuteMessages
  logger
  channel

  constructor(_configs) {
    this.consumeQueueName = _configs.consumeQueueName
    this.sourceClient = _configs.sourceClient
    this.targetClient = _configs.targetClient
    this.logger = _configs.logger.child({ service: _configs.service })
    this.lightClientType = _configs.lightClientType
    this.lightClientAdapterABI = _configs.lightClientAdapterABI
    this.lightClientAdapterContractAddress = _configs.lightClientAdapterContractAddress
    this.yahoABI = _configs.yahoABI
    this.yaruAddress = _configs.yaruAddress
    this.yaruABI = _configs.yaruABI
    this.isCallYaruExecuteMessages = _configs.isCallYaruExecuteMessages
  }

  async start() {
    try {
      this.logger.info(`Starting TxSender service`)
      this.amqpConnection = await amqp.connect(process.env.RABBITMQ_URL)
      this.channel = await this.amqpConnection.createChannel()

      // Ensure the queue exists
      await this.channel.assertQueue(this.consumeQueueName, { durable: true })
      await this.channel.prefetch(1)

      this.logger.info(`TxSender connected to queue: ${this.consumeQueueName}`)

      // Set up a consumer with explicit acknowledgement
      this.channel.consume(
        this.consumeQueueName,
        async (msg) => {
          if (!msg) {
            this.logger.warn(`Received null message from queue ${this.consumeQueueName}`)
            return
          }

          let txHash = msg.content.toString()
          this.logger.info(`Received message for tx hash ${txHash} from queue ${this.consumeQueueName}`)

          try {
            // Retrieve proof from Redis
            this.logger.debug(`Fetching proof from Redis for tx hash ${txHash}`)
            const redisData = await redisClient.get(txHash)

            if (!redisData) {
              this.logger.error(`No data found in Redis for tx hash ${txHash}`)

              // Implement a waiting and retry mechanism
              const retryCount = (msg.properties.headers?.retryCount || 0) + 1
              if (retryCount <= 5) {
                // Requeue with exponential backoff
                const delay = Math.pow(2, retryCount) * 1000 // 2s, 4s, 8s, 16s, 32s
                this.logger.info(
                  `Data not yet in Redis, requeueing message ${txHash} for retry ${retryCount} after ${delay}ms`
                )

                setTimeout(() => {
                  this.channel.publish('', this.consumeQueueName, msg.content, {
                    headers: { retryCount }
                  })
                  this.channel.ack(msg)
                }, delay)
              } else {
                this.logger.warn(`Max retries (${retryCount - 1}) reached for ${txHash}, acknowledging message`)
                this.channel.ack(msg)
              }
              return
            }

            this.logger.debug(`Successfully retrieved proof from Redis for tx hash ${txHash}`)
            const txHashResult = JSON.parse(redisData)

            // Select the appropriate ABI based on light client type
            const abi =
              this.lightClientType == 'dendreth'
                ? [
                    parseAbiItem(
                      'function verifyAndStoreDispatchedMessage(bytes32 srcFinalizedHeader, uint64 srcSlot, bytes32[] calldata slotProof,uint64 txSlot,bytes32[] memory receiptsRootProof,bytes32 receiptsRoot,bytes[] memory receiptProof,bytes memory txIndexRLPEncoded,uint256 logIndex) external'
                    )
                  ]
                : [
                    parseAbiItem(
                      'function verifyAndStoreDispatchedMessage(uint64 headerSlot, uint64 txSlot, bytes32[] memory receiptsRootProof, bytes32 receiptsRoot, bytes[] memory receiptProof, bytes memory txIndexRLPEncoded, uint256 logIndex) external'
                    )
                  ]

            // Simulate the contract call first
            this.logger.debug(`Simulating contract call for tx hash ${txHash}`)
            let { request } = await this.targetClient.simulateContract({
              account: privateKeyToAccount(process.env.PRIVATE_KEY),
              abi: abi,
              functionName: 'verifyAndStoreDispatchedMessage',
              address: this.lightClientAdapterContractAddress,
              args: txHashResult.proof
            })

            // Execute the contract call
            this.logger.debug(`Executing verifyAndStoreDispatchMessage with proof for tx hash ${txHash}...`)
            let tx = await this.targetClient.writeContract(request)

            this.logger.info(
              `Success! Event proof for tx ${txHash} verified on ${this.targetClient.chain.name}: tx hash ${tx}`
            )

            if (this.isCallYaruExecuteMessages) {
              this.logger.debug('Waiting for one block to be mined...')
              await this.targetClient.waitForTransactionReceipt({ hash: tx })
              const messageDispatchedReceipt = await this.sourceClient.getTransactionReceipt({
                hash: txHash
              })

              let messageDispatchedLog = messageDispatchedReceipt.logs.filter(
                (log) => log.topics[0] == '0x218247aabc759e65b5bb92ccc074f9d62cd187259f2a0984c3c9cf91f67ff7cf'
              )

              if (messageDispatchedLog.length) {
                const decodedLog = decodeEventLog({
                  abi: this.yahoABI,
                  data: messageDispatchedLog[0].data,
                  topics: messageDispatchedLog[0].topics
                })

                let { request: executeMessageRequest } = await this.targetClient.simulateContract({
                  account: privateKeyToAccount(process.env.PRIVATE_KEY),
                  abi: this.yaruABI,
                  functionName: 'executeMessages',
                  address: this.yaruAddress,
                  args: [
                    [
                      {
                        nonce: decodedLog.args.message.nonce.toString(),
                        targetChainId: parseInt(decodedLog.args.message.targetChainId.toString()),
                        threshold: parseInt(decodedLog.args.message.threshold.toString()),
                        sender: decodedLog.args.message.sender,
                        receiver: decodedLog.args.message.receiver,
                        data: decodedLog.args.message.data,
                        reporters: decodedLog.args.message.reporters,
                        adapters: decodedLog.args.message.adapters
                      }
                    ]
                  ]
                })

                this.logger.debug(`Executing executeMessage for tx hash ${txHash} on Yaru contract...`)
                let tx = await this.targetClient.writeContract(executeMessageRequest)
                this.logger.info(
                  `Success! Message for ${this.sourceClient.chain.name} tx ${txHash} executed on ${this.targetClient.chain.name}: tx hash ${tx}`
                )
              }
            }

            // Acknowledge the message after successful processing
            this.channel.ack(msg)
            this.logger.info(`Acknowledged message ${txHash} from queue ${this.consumeQueueName}`)
          } catch (err) {
            this.logger.error(`Error sending tx for ${txHash}: ${err.message}`)

            // Handle retriable errors
            const isRetriable =
              err.message &&
              (err.message.includes('timeout') ||
                err.message.includes('network') ||
                err.message.includes('nonce') ||
                err.message.includes('gas') ||
                err.message.includes('underpriced'))

            if (isRetriable) {
              const retryCount = (msg.properties.headers?.retryCount || 0) + 1
              if (retryCount <= 2) {
                // Requeue with exponential backoff
                const delay = Math.pow(2, retryCount) * 1000
                this.logger.info(
                  `Retriable error, requeueing message ${txHash} for retry ${retryCount} after ${delay}ms`
                )

                setTimeout(() => {
                  this.channel.publish('', this.consumeQueueName, msg.content, {
                    headers: { retryCount }
                  })
                  this.channel.ack(msg)
                }, delay)
              } else {
                this.logger.warn(`Max retries (${retryCount - 1}) reached for ${txHash}, acknowledging message`)
                this.channel.ack(msg)
              }
            } else {
              // For non-retriable errors, acknowledge to remove from queue
              this.logger.warn(`Non-retriable error for ${txHash}, acknowledging message`)
              this.channel.ack(msg)
            }
          }
        },
        { noAck: false }
      )
    } catch (error) {
      this.logger.error(`Fatal error starting TxSender: ${error}`)
      throw error
    }
  }

  async stop() {
    this.logger.info('Stopping TxSender')
    if (this.channel) {
      try {
        await this.channel.close()
        this.logger.info('TxSender channel closed')
      } catch (err) {
        this.logger.error(`Error closing TxSender channel: ${err}`)
      }
    }

    if (this.amqpConnection) {
      try {
        await this.amqpConnection.close()
        this.logger.info('TxSender AMQP connection closed')
      } catch (err) {
        this.logger.error(`Error closing TxSender AMQP connection: ${err}`)
      }
    }
  }
}
