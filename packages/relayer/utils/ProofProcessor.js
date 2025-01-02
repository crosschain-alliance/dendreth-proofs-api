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

  constructor(_configs) {
    this.consumeQueueName = _configs.consumeQueueName
    this.publishQueueName = _configs.publishQueueName
    this.sendToTxSenderQueue = _configs.sendToTxSenderQueue
    this.logger = _configs.logger.child({ service: _configs.service })
  }

  async start() {
    this.amqpConnection = await amqp.connect(process.env.RABBITMQ_URL)

    const channel = await this.amqpConnection.createChannel()

    await channel.assertQueue(this.consumeQueueName, { durable: true })
    await channel.prefetch(1)

    channel.consume(
      this.consumeQueueName,
      async (msg) => {
        let txHash = msg.content.toString()

        this.logger.info(`Fetching proof for tx hash  ${txHash}`)
        try {
          axiosRetry(axios, { retries: 2 })
          let { data: proof } = await axios.get(
            `${process.env.PROOF_API}/v1/get-message-dispatched-proof/${process.env.LC_TYPE}/${txHash}`,
            {
              timeout: process.env.SERVER_REQUEST_TIMEOUT
            }
          )

          let proofResult = proof.proof

          this.logger.info(`${txHash} with proof ${proofResult}`)

          this.logger.info(`Writing into redis for tx hash ${txHash}`)
          const result = {
            proof: proofResult
          }

          await redisClient.set(txHash, JSON.stringify(result))
          this.sendToTxSenderQueue(Buffer.from(txHash))

          channel.ack(msg)
        } catch (err) {
          this.logger.error(err)
        }
      },
      { noAck: false }
    )
  }
}
