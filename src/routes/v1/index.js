import 'dotenv/config'
import { createPublicClient, http, createWalletClient, parseAbiItem } from 'viem'
import * as chains from 'viem/chains'
import axios from 'axios'
import { RLP } from '@ethereumjs/rlp'

import logger from '../../utils/logger.js'
import dendrethAbi from '../../utils/abi/dendreth.js'
import { getReceiptProof, getReceiptsRootProof } from '../../utils/proofs.js'
import sleep from '../../utils/sleep.js'
import { privateKeyToAccount } from 'viem/accounts'

const MESSAGE_DISPATCHED_TOPIC = '0x218247aabc759e65b5bb92ccc074f9d62cd187259f2a0984c3c9cf91f67ff7cf'

const getMessageDispatchedProof = async (_request, _reply) => {
  const { transactionHash } = _request.params

  const sourceChain = Object.values(chains).find((_chain) => _chain.id === parseInt(process.env.SOURCE_CHAIN_ID))
  const targetChain = Object.values(chains).find((_chain) => _chain.id === parseInt(process.env.TARGET_CHAIN_ID))

  const sourceClient = createPublicClient({
    chain: sourceChain,
    transport: http(process.env.SOURCE_RPC)
  })

  const targetClient = createPublicClient({
    chain: targetChain,
    transport: http(process.env.TARGET_RPC)
  })

  const receipt = await sourceClient.getTransactionReceipt({
    hash: transactionHash
  })

  logger.info('Checking finality ...')
  let transactionSlot = null
  const {
    data: { data }
  } = await axios.get(`https://sepolia.beaconcha.in/api/v1/execution/block/${receipt.blockNumber}`)
  const [
    {
      posConsensus: { slot, finalized }
    }
  ] = data
  if (!finalized) {
    return _reply.code(400).send({ error: 'Block not finalized' })
  }
  transactionSlot = slot

  logger.info('Calculating receipt proof ...')
  const { receiptProof, receiptsRoot } = await getReceiptProof(transactionHash, sourceClient)

  logger.info('Getting the correct light client slot ...')
  // NOTE: find the first slot > transactionSlot
  const initialIndex = await targetClient.readContract({
    address: process.env.LC_ADDRESS,
    abi: dendrethAbi,
    functionName: 'currentIndex'
  })
  let currentIndex = initialIndex
  let inverted = false
  const lightClientSlot = await targetClient.readContract({
    address: process.env.LC_ADDRESS,
    abi: dendrethAbi,
    functionName: 'optimisticSlots',
    args: [currentIndex]
  })

  logger.info('Getting receipts root proof ...')
  const { receiptsRootProof, receiptsRoot: receiptsRootFromSlot } = await getReceiptsRootProof(
    Number(lightClientSlot),
    Number(transactionSlot),
    [process.env.SOURCE_BEACON_API_URL],
    sourceChain
  )

  if (receiptsRoot !== receiptsRootFromSlot) {
    return _reply
      .code(500)
      .send({ error: 'Receipts root mismatch.' + 'Slot root: ' + receiptsRootFromSlot + 'Tx root: ' + receiptsRoot })
  }

  logger.info('Getting log index ...')
  const logIndex = receipt.logs.findIndex(({ topics }) => topics[0] === MESSAGE_DISPATCHED_TOPIC)
  if (logIndex < 0) {
    return _reply.code(404).send({ error: 'Log not found' })
  }

  const proof = [
    parseInt(lightClientSlot),
    parseInt(transactionSlot),
    receiptsRootProof,
    receiptsRoot,
    receiptProof,
    '0x' + Buffer.from(RLP.encode(receipt.transactionIndex)).toString('hex'),
    logIndex
  ]

  if (process.env.WRITE_TO_VERIFY == 'true') {
    logger.info('Verifying MessageDispatched event on DendrETH Adapter')
    const account = privateKeyToAccount(process.env.PRIVATE_KEY)
    const targetWriteClient = createWalletClient({
      account,
      chain: targetChain,
      transport: http(process.env.TARGET_RPC)
    })

    let { request } = await targetClient.simulateContract({
      account,
      abi: [
        parseAbiItem(
          'function verifyAndStoreDispatchedMessage(uint64 srcSlot,uint64 txSlot,bytes32[] memory receiptsRootProof,bytes32 receiptsRoot,bytes[] memory receiptProof,bytes memory txIndexRLPEncoded,uint256 logIndex) external'
        )
      ],
      functionName: 'verifyAndStoreDispatchedMessage',
      address: process.env.DENDRETH_ADAPTER_ADDRESS,
      args: proof
    })

    let tx = await targetWriteClient.writeContract(request)

    logger.info(`Verified tx ${tx} `)
  }

  _reply.send({
    proof
  })
}

const handler = (_fastify, _opts, _done) => {
  _fastify.get('/get-message-dispatched-proof/:transactionHash', getMessageDispatchedProof)
  _done()
}

export default handler
