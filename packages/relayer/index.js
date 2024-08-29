import axios from 'axios'
import dotenv from 'dotenv'
dotenv.config()
import { MongoClient } from 'mongodb'
import Watcher from './utils/Watcher.js'
import YahoABI from './utils/YahoABI.js'
import DendrETHAdapterABI from './utils/DendrETHAdapterABI.js'
import logger from './utils/Logger.js'
import Executor from './utils/Executor.js'
import { createWalletClient, http, publicActions } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as chains from 'viem/chains'

const sourceChain = Object.values(chains).find(({ id }) => id.toString() === process.env.SOURCE_CHAIN_ID)
if (!sourceChain) throw new Error('Invalid SOURCE_CHAIN_ID')
const targetChain = Object.values(chains).find(({ id }) => id.toString() === process.env.TARGET_CHAIN_ID)
if (!sourceChain) throw new Error('Invalid TARGET_CHAIN_ID')

const mongoClient = new MongoClient(process.env.MONGO_DB_URI)
await mongoClient.connect()
const db = mongoClient.db('messagedispatch')

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

const adapter = process.env.DENDRETH_ADAPTER_ADDRESS
const blockNumber = await sourceClient.getBlockNumber()

const watcher = new Watcher({
  abi: YahoABI,
  client: sourceClient,
  contractAddress: process.env.SOURCE_YAHO_ADDRESS,
  eventName: 'MessageDispatched',
  logger,
  service: `DendrETHWatcher`,
  watchIntervalTimeMs: Number(process.env.WATCH_INTERVAL_TIME_MS),
  onLogs: async (_logs) => {
    // request proof from API
    const txHash = _logs.transactionHash
    try {
      const { data: proof } = await axios.get(`${process.env.PROOF_API}/${txHash}`)
    } catch (err) {
      if (err == 'Block not finalized') {
        // it's the first time catching the event
        await db.collection('messageDispatchEvents').findOneAndUpdate(
          { id: txHash },
          {
            $setOnInsert: {
              chainId: sourceClient?.chain?.id,
              messageDispatchedTransactionHash: txHash,
              status: 'pendingBlockToFinalize',
              lastChecked: new Date(),
              retries: 0
            }
          },
          { upsert: true, returnDocument: 'after' }
        )
      }
    }
  }
})

watcher.start()

const executor = new Executor({
  logger,
  client: targetClient,
  contractAddress: process.env.DENDRETH_ADAPTER_ADDRESS,
  abi: DendrETHAdapterABI,
  eventName: verifyAndStoreDispatchedMessage,
  database: db,
  _watchIntervalTimes: process.env.EXECUTOR_INTERVAL_TIME_MS
})

executor.start()
