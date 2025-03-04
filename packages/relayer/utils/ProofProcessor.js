import amqp from 'amqplib'
import 'dotenv/config'
import axios from 'axios'
import axiosRetry from 'axios-retry'
import redisClient from './redisClient.js'

// 1. consume message_dispatch_event_queue
// 2. call proof server (logic in packages/server)
// 3. Push the proof into redis and tx_to_send_queue

export default class ProofProcessor {
  consumeQueueName
  publishQueueName
  sendToTxSenderQueue
  amqpConnection
  logger
  channel

  constructor(_configs) {
    this.consumeQueueName = _configs.consumeQueueName
    this.publishQueueName = _configs.publishQueueName
    this.sendToTxSenderQueue = _configs.sendToTxSenderQueue
    this.logger = _configs.logger.child({ service: _configs.service })
  }

  async start() {
    try {
      this.logger.info(`Starting ProofProcessor service`)
      this.amqpConnection = await amqp.connect(process.env.RABBITMQ_URL)
      this.channel = await this.amqpConnection.createChannel()

      // Ensure both queues exist
      await this.channel.assertQueue(this.consumeQueueName, { durable: true })
      await this.channel.assertQueue(this.publishQueueName, { durable: true })
      await this.channel.prefetch(1)

      this.logger.info(`ProofProcessor connected to queues: ${this.consumeQueueName} and ${this.publishQueueName}`)

      this.channel.consume(
        this.consumeQueueName,
        async (msg) => {
          if (!msg) {
            this.logger.warn(`Received null message from queue ${this.consumeQueueName}`)
            return
          }

          let txHash = msg.content.toString()
          this.logger.info(`Processing tx hash ${txHash} from queue ${this.consumeQueueName}`)

          try {
            // Get proof from API
            this.logger.info(`Fetching proof for tx hash ${txHash} from API`)
            let { data: proof } = await axios.get(
              `${process.env.PROOF_API}/v1/get-message-dispatched-proof/${process.env.LC_TYPE}/${txHash}`,
              {
                timeout: parseInt(process.env.SERVER_REQUEST_TIMEOUT, 10) || 10 * 60 * 1000
              }
            )

            let proofResult = proof.proof

            // Log the proof result
            this.logger.info(`Received proof for ${txHash}`)

            // Save to Redis
            this.logger.info(`Saving proof to Redis for tx hash ${txHash}`)
            const result = {
              proof: proofResult,
              timestamp: Date.now()
            }

            await redisClient.set(txHash, JSON.stringify(result))
            this.logger.info(`Successfully saved proof to Redis for tx hash ${txHash}`)

            // Send to TxSender queue
            // 1. Using the provided callback function
            this.logger.info(`Sending ${txHash} to TxSender queue via callback`)
            this.sendToTxSenderQueue(Buffer.from(txHash))

            // // 2. Also possible to send directly via the channel as a backup
            // this.logger.info(`Sending ${txHash} to TxSender queue via direct publish`)
            // await this.channel.sendToQueue(this.publishQueueName, Buffer.from(txHash), {
            //   persistent: true,
            //   messageId: `${txHash}-${Date.now()}`
            // })

            this.logger.info(`Successfully sent ${txHash} to TxSender queue`)

            // Acknowledge the message
            this.channel.ack(msg)
            this.logger.info(`Acknowledged message ${txHash} from queue ${this.consumeQueueName}`)
          } catch (err) {
            this.logger.error(`Error processing tx ${txHash}: ${err}`)

            // Delayed retry logic
            const retryCount = (msg.properties.headers?.retryCount || 0) + 1
            if (retryCount <= 3) {
              // Requeue with exponential backoff
              const delay = Math.pow(2, retryCount) * 1000 // 2s, 4s, 8s
              this.logger.info(`Requeueing message ${txHash} for retry ${retryCount} after ${delay}ms`)

              setTimeout(() => {
                this.channel.publish('', this.consumeQueueName, msg.content, {
                  headers: { retryCount }
                })
                this.channel.ack(msg)
              }, delay)
            } else {
              // After max retries, acknowledge the message to prevent endless retries
              this.logger.warn(`Max retries (${retryCount - 1}) reached for ${txHash}, acknowledging message`)
              this.channel.ack(msg)
            }
          }
        },
        { noAck: false }
      )

      this.logger.info('ProofProcessor started and listening for messages')
    } catch (error) {
      this.logger.error(`Fatal error starting ProofProcessor: ${error}`)
      throw error
    }
  }

  async stop() {
    this.logger.info('Stopping ProofProcessor')
    if (this.channel) {
      try {
        await this.channel.close()
        this.logger.info('ProofProcessor channel closed')
      } catch (err) {
        this.logger.error(`Error closing ProofProcessor channel: ${err}`)
      }
    }

    if (this.amqpConnection) {
      try {
        await this.amqpConnection.close()
        this.logger.info('ProofProcessor AMQP connection closed')
      } catch (err) {
        this.logger.error(`Error closing ProofProcessor AMQP connection: ${err}`)
      }
    }
  }
}
