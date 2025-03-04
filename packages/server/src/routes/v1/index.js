import 'dotenv/config'
import { createPublicClient, http, parseAbiItem, bytesToHex } from 'viem'
import * as chains from 'viem/chains'
import axios from 'axios'
import { RLP } from '@ethereumjs/rlp'
import { Tree } from '@chainsafe/persistent-merkle-tree'
import logger from '../../utils/logger.js'
import dendrethLightClientAbi from '../../utils/abi/dendrethABI.js'
import heliosLightClientAbi from '../../utils/abi/heliosABI.js'
import { getBeaconApi, getReceiptProof, getReceiptsRootProof } from '../../utils/proofs.js'
import { fetchBlockHeaderProof } from '../../utils/proofs.js'

const MESSAGE_DISPATCHED_TOPIC = '0x218247aabc759e65b5bb92ccc074f9d62cd187259f2a0984c3c9cf91f67ff7cf'

const getMessageDispatchedProof = async (_request, _reply) => {
  const { transactionHash, lcType } = _request.params

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

  if (sourceClient.chain.id === 10200) {
    // Chiado
    const blockNumber = receipt.blockNumber
    // get latest beacon slot
    let beaconBlock = await axios.get(`${process.env.SOURCE_BEACON_API_URL}/eth/v1/beacon/blocks/head`)

    let slot = BigInt(beaconBlock.data.data.message.slot)
    let blockNumberFromBeaconBlock = BigInt(beaconBlock.data.data.message.body.execution_payload.block_number)

    let diff = blockNumberFromBeaconBlock - blockNumber

    do {
      if (diff == 0n) break

      try {
        beaconBlock = await axios.get(`${process.env.SOURCE_BEACON_API_URL}/eth/v1/beacon/blocks/${slot - diff}`)
        blockNumberFromBeaconBlock = beaconBlock.data.data.message.body.execution_payload.block_number
        slot = BigInt(beaconBlock.data.data.message.slot)
        blockNumberFromBeaconBlock = BigInt(beaconBlock.data.data.message.body.execution_payload.block_number)
        diff = blockNumberFromBeaconBlock - blockNumber
      } catch (err) {
        return _reply.code(400).send({ error: 'Cant find coresponding slot' })
      }
    } while (diff != 0n)

    if (diff == 0) {
      console.log(`Found slot ${slot} corresponding to ${blockNumber} block Number on ${sourceClient.chain.name}`)
    }
    transactionSlot = slot
  } else {
    const {
      data: { data }
    } = await axios.get(`${process.env.BEACONCHA_IN_URL}/api/v1/execution/block/${receipt.blockNumber}`)
    const [
      {
        posConsensus: { slot, finalized }
      }
    ] = data

    // if (!finalized) {
    //   return _reply.code(400).send({ error: 'Block not finalized' })
    // }
    transactionSlot = slot
  }

  logger.info('Calculating receipt proof ...')
  const { receiptProof, receiptsRoot } = await getReceiptProof(transactionHash, sourceClient)

  logger.info('Getting the correct light client slot ...')
  // NOTE: find the first slot > transactionSlot

  let lightClientFinalizedHeader

  if (lcType == 'helios') {
    const headSlot = await targetClient.readContract({
      address: process.env.LIGHT_CLIENT_ADDRESS,
      abi: heliosLightClientAbi,
      functionName: 'head'
    })

    lightClientFinalizedHeader = await targetClient.readContract({
      address: process.env.LIGHT_CLIENT_ADDRESS,
      abi: heliosLightClientAbi,
      functionName: 'headers',
      args: [headSlot]
    })
  } else if (lcType == 'dendreth') {
    const initialIndex = await targetClient.readContract({
      address: process.env.LIGHT_CLIENT_ADDRESS,
      abi: dendrethLightClientAbi,
      functionName: 'currentIndex'
    })
    let currentIndex = initialIndex

    lightClientFinalizedHeader = await targetClient.readContract({
      address: process.env.LIGHT_CLIENT_ADDRESS,
      abi: dendrethLightClientAbi,
      functionName: 'finalizedHeaders',
      args: [currentIndex]
    })
  }

  let chainConfig
  let api
  let config
  ;({ api, config, chainConfig } = getBeaconApi(sourceChain, chainConfig, [process.env.SOURCE_BEACON_API_URL]))

  let finalizedBlockHeader = (await api.beacon.getBlockHeader({ blockId: lightClientFinalizedHeader })).value()

  let lightClientSlot = finalizedBlockHeader.header.message.slot
  const finalizedBlockHeaderView = config
    .getForkTypes(lightClientSlot)
    .BeaconBlockHeader.toViewDU(finalizedBlockHeader.header.message)

  let finalizedBlockHeaderTree = new Tree(finalizedBlockHeaderView.node)

  const lightClientSlotProof = finalizedBlockHeaderTree.getSingleProof(8).map(bytesToHex)

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

  // lightClientFinalizedHeader: the block root of the beacon block, stored on light client contract, it is not the execution block hash
  // lightClientSlot: the corresponding slot
  // execution block's block hash is stored in adapter contract

  const proof =
    lcType == 'dendreth'
      ? [
          lightClientFinalizedHeader,
          parseInt(lightClientSlot),
          lightClientSlotProof,
          parseInt(transactionSlot),
          receiptsRootProof,
          receiptsRoot,
          receiptProof,
          '0x' + Buffer.from(RLP.encode(receipt.transactionIndex)).toString('hex'),
          logIndex
        ]
      : [
          parseInt(lightClientSlot),
          parseInt(transactionSlot),
          receiptsRootProof,
          receiptsRoot,
          receiptProof,
          '0x' + Buffer.from(RLP.encode(receipt.transactionIndex)).toString('hex'),
          logIndex
        ]

  _reply.send({
    proof
  })
}

const getBlockHeaderProof = async (_request, _reply) => {
  const { slot } = _request.params

  logger.info(`Getting block header proof for slot ${slot}`)
  const sourceChain = Object.values(chains).find((_chain) => _chain.id === parseInt(process.env.SOURCE_CHAIN_ID))

  const blockHeaderProof = await fetchBlockHeaderProof(slot, sourceChain, [process.env.SOURCE_BEACON_API_URL])

  const proof = [
    blockHeaderProof.slot,
    blockHeaderProof.blockNumber,
    blockHeaderProof.blockNumberProof,
    blockHeaderProof.blockHash,
    blockHeaderProof.blockHashProof
  ]

  _reply.send({
    proof
  })
}
const handler = (_fastify, _opts, _done) => {
  _fastify.get(`/get-block-header-proof/:slot`, getBlockHeaderProof)
  _fastify.get('/get-message-dispatched-proof/:lcType/:transactionHash', getMessageDispatchedProof)
  _done()
}

export default handler
