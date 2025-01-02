import redis from 'redis'
import 'dotenv/config'

// Create a Redis client
const redisClient = redis.createClient({
  url: process.env.REDIS_URL
})

// Event listener for successful connection
redisClient.on('connect', () => {
  console.log('Successfully connected to Redis on port 6379!')
})

// Event listener for errors
redisClient.on('error', (err) => {
  console.error('Redis connection error:', err)
})

export default redisClient
