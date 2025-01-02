import amqp from 'amqplib'
import 'dotenv/config'

export async function createConnectionToQueue({ queueName, callback }) {
  try {
    const connection = await amqp.connect(process.env.RABBITMQ_URL)
    const channel = await connection.createChannel()
    await channel.assertQueue(queueName)

    const sendToQueue = (dataToSend) => channel.sendToQueue(queueName, dataToSend)

    await callback({ queueName, channel, sendToQueue })
  } catch (err) {
    console.log('Err ', err)
  }
}
