import amqp from 'amqplib'
import logger from './Logger.js'

/**
 * Creates a reliable connection to a RabbitMQ queue
 * @param {Object} config - Configuration object
 * @param {string} config.queueName - Name of the queue to connect to
 * @param {Function} config.callback - Callback function to be called after connection
 * @returns {Promise<void>}
 */
export async function createConnectionToQueue({ queueName, callback }) {
  try {
    const log = logger.child({ service: 'AMQP-Client', queue: queueName })
    log.info(`Connecting to AMQP queue: ${queueName}`)

    // Create a connection
    const connection = await amqp.connect(process.env.RABBITMQ_URL)

    // Handle connection errors and close events
    connection.on('error', (err) => {
      log.error(`AMQP connection error: ${err.message}`)
      setTimeout(() => createConnectionToQueue({ queueName, callback }), 5000)
    })

    connection.on('close', () => {
      log.info('AMQP connection closed, attempting to reconnect...')
      setTimeout(() => createConnectionToQueue({ queueName, callback }), 5000)
    })

    // Create a channel
    const channel = await connection.createChannel()

    // Assert that the queue exists (will create if it doesn't)
    await channel.assertQueue(queueName, { durable: true })

    // Define the sendToQueue function
    const sendToQueue = (content) => {
      try {
        log.info(`Sending message to queue ${queueName}`)
        const result = channel.sendToQueue(queueName, content, { persistent: true })
        if (!result) {
          log.warn(`Queue ${queueName} is full or connection is blocked, message will be buffered`)
        }
        return result
      } catch (err) {
        log.error(`Error sending message to queue ${queueName}: ${err.message}`)
        throw err
      }
    }

    // Call the callback with the channel and sendToQueue function
    callback({ channel, sendToQueue })

    log.info(`Successfully connected to queue: ${queueName}`)

    // Return a function to close the connection
    return async () => {
      try {
        await channel.close()
        await connection.close()
        log.info(`Closed connection to queue: ${queueName}`)
      } catch (err) {
        log.error(`Error closing connection to queue ${queueName}: ${err.message}`)
      }
    }
  } catch (err) {
    logger.error(`Failed to connect to queue ${queueName}: ${err.message}`)
    // Retry connection after delay
    setTimeout(() => createConnectionToQueue({ queueName, callback }), 5000)
  }
}
