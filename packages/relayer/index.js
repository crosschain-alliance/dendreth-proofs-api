import axios from 'axios'
import dotenv from 'dotenv'
dotenv.config()
import Watcher  from "./utils/Watcher.js"
import YahoABI from './utils/YahoABI.js'
import logger from './utils/Logger.js'
import { createWalletClient, http, publicActions } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import * as chains from "viem/chains"


const sourceChain = Object.values(chains).find(({ id }) => id.toString() === (process.env.SOURCE_CHAIN_ID))
if (!sourceChain) throw new Error("Invalid SOURCE_CHAIN_ID")
const targetChain = Object.values(chains).find(({ id }) => id.toString() === (process.env.TARGET_CHAIN_ID))
if (!sourceChain) throw new Error("Invalid TARGET_CHAIN_ID")

const sourceClient = createWalletClient({
account: privateKeyToAccount(process.env.PRIVATE_KEY ),
chain: sourceChain ,
transport: http(process.env.SOURCE_RPC ? process.env.SOURCE_RPC: "" ),
}).extend(publicActions)
const targetClient = createWalletClient({
account: privateKeyToAccount(process.env.PRIVATE_KEY ),
chain: targetChain ,
transport: http(process.env.TARGET_RPC ? process.env.TARGET_RPC: "" ),
}).extend(publicActions)

const adapter = process.env.DENDRETH_ADAPTER_ADDRESS;
const blockNumber = await sourceClient.getBlockNumber()

const watcher =
    
    new Watcher ({
        abi: YahoABI,
        client: sourceClient,
        contractAddress: process.env.SOURCE_YAHO_ADDRESS,
        eventName: "MessageDispatched",
        logger,
        service: `DendrETHWatcher`,
        watchIntervalTimeMs: Number(process.env.WATCH_INTERVAL_TIME_MS),
        onLogs: async (_logs) => {

            // request proof from API
            const txHash = _logs.transactionHash;
            const { data: proof } = await axios.get(`${process.env.PROOF_API}/${txHash}`)

            // call DendrETH Adapter 

            const {request} = await targetClient.simulateContract({
                account:  privateKeyToAccount(process.env.PRIVATE_KEY),
                abi: [
                  parseAbiItem(
                    'function verifyAndStoreDispatchedMessage(uint64 srcSlot,uint64 txSlot,bytes32[] memory receiptsRootProof,bytes32 receiptsRoot,bytes[] memory receiptProof,bytes memory txIndexRLPEncoded,uint256 logIndex) external'
                  )
                ],
                functionName: 'verifyAndStoreDispatchedMessage',
                address: process.env.DENDRETH_ADAPTER_ADDRESS,
                args: proof
            })

            const tx = await targetClient.writeContract(request);
            this.logger.info(`verifyAndStoreDispatchedMessage on ${this.client.chain.name}: ${tx}`)
        }


    })

watcher.start()