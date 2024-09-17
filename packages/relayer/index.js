import axios from 'axios'
import dotenv from 'dotenv'
dotenv.config()
import Relayer from './utils/Relayer.js'
import YahoABI from './utils/YahoABI.js'
import DendrETHAdapterABI from './utils/DendrETHAdapterABI.js'
import logger from './utils/Logger.js'
import { createWalletClient, http, publicActions } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as chains from 'viem/chains'

const sourceChain = Object.values(chains).find(({ id }) => id.toString() === process.env.SOURCE_CHAIN_ID)
if (!sourceChain) throw new Error('Invalid SOURCE_CHAIN_ID')
const targetChain = Object.values(chains).find(({ id }) => id.toString() === process.env.TARGET_CHAIN_ID)
if (!targetChain) throw new Error('Invalid TARGET_CHAIN_ID')

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

const relayer = new Relayer({
  abi: YahoABI,
  sourceClient,
  targetClient,
  contractAddress: process.env.SOURCE_YAHO_ADDRESS,
  eventName: 'MessageDispatched',
  logger,
  service: 'DendrETHProver',
  watchIntervalTimeMs: Number(process.env.WATCH_INTERVAL_TIME_MS),
  requiredBlockConfirmation: Number(process.env.REQUIRED_BLOCK_CONFIRMATION),
  onLogs: async (_logs) => {
    // request proof from API
    logger.info(`Processing ${_logs.length} MessageDispatched events`)
    for (let i = 0; i < _logs.length; i++) {
      try {
        let txHash = _logs[i].transactionHash
        let { data: proof } = await axios.get(`${process.env.PROOF_API}/${txHash}`)

        let { request } = await targetClient.simulateContract({
          account: privateKeyToAccount(process.env.PRIVATE_KEY),
          abi: DendrETHAdapterABI,
          functionName: 'verifyAndStoreDispatchedMessage',
          address: process.env.DENDRETH_ADAPTER_ADDRESS,
          args: proof.proof
        })

        let tx = await targetClient.writeContract(request)
        logger.info(`Event proof successfully verified: ${tx} `)
      } catch (error) {
        logger.error(error)
      }
    }
  }
})

relayer.start()
