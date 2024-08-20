import dotenv from 'dotenv'
dotenv.config()
import Fastify from 'fastify'

import routes from './routes/v1/index.js'

const fastify = Fastify({
  logger: true,
  requestTimeout: 30000,
  exposeHeadRoutes: true
})

const port = process.env.PORT || 3002

fastify.route({
  method: 'OPTIONS',
  url: '/*',
  handler: async (request, reply) => {
    var reqAllowedHeaders = request.headers['access-control-request-headers']
    if (reqAllowedHeaders !== undefined) {
      reply.header('Access-Control-Allow-Headers', reqAllowedHeaders)
    }
    reply
      .code(204)
      .header('Content-Length', '0')
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Credentials', true)
      .header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE')
      .send()
  }
})

fastify.addHook('onRequest', function (request, reply, next) {
  reply.header('Access-Control-Allow-Origin', '*')
  reply.header('Access-Control-Allow-Credentials', true)
  next()
})

fastify.register(routes, { prefix: '/v1' })

fastify.listen({ port }, (_err, _address) => {
  if (_err) {
    fastify.log._error(_err)
  }
  fastify.log.info(`Fastify is listening on port: ${_address}`)
})
