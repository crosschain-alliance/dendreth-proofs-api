import { TransactionType } from '@ethereumjs/tx'
import { hexToBytes, concatBytes, bigIntToBytes, intToBytes } from '@ethereumjs/util'
import { toHexString, fromHexString } from '@chainsafe/ssz'
import { RLP } from '@ethereumjs/rlp'
import { Trie } from '@ethereumjs/trie'
import { bytesToHex } from 'viem'
import { createChainConfig, createChainForkConfig } from '@lodestar/config'
import { ProofType, Tree } from '@chainsafe/persistent-merkle-tree'
import { getClient } from '@lodestar/api'
import { mainnetChainConfig, sepoliaChainConfig, chiadoChainConfig, gnosisChainConfig } from '@lodestar/config/networks'
import { sepolia, gnosisChiado, gnosis, mainnet } from 'viem/chains'

const SLOTS_PER_HISTORICAL_ROOT = 8192

export const getReceiptsRootProof = async (_srcSlot, _targetSlot, _urls, _sourceChain) => {
  let chainConfig
  let api
  let config
  ;({ api, config, chainConfig } = getBeaconApi(_sourceChain, chainConfig, _urls))

  let receiptsRootProof
  let receiptsRoot

  const statePath = ['state_root']
  const rootPath = ['block_roots', _targetSlot % SLOTS_PER_HISTORICAL_ROOT]
  const receiptPath = ['body', 'execution_payload', 'receipts_root']

  if (_srcSlot == _targetSlot) {
    const oldBlockRes = await api.beacon.getBlockV2({
      blockId: _targetSlot
    })

    const oldBlockView = config.getForkTypes(_srcSlot).BeaconBlock.toView(oldBlockRes.value().message)

    const oldBlockProof = oldBlockView.createProof([receiptPath])

    const oldBlockTree = Tree.createFromProof(oldBlockProof)
    const receiptProof = oldBlockTree.getProof({
      type: ProofType.single,
      gindex: RECEIPT_INDEX
    })

    receiptsRootProof = receiptProof.witnesses
      .concat(rootProof.witnesses)
      .concat(stateRootProof.witnesses)
      .map(bytesToHex)
    receiptsRoot = toHexString(receiptProof.leaf)
  } else if (_srcSlot - _targetSlot < SLOTS_PER_HISTORICAL_ROOT) {
    const STATE_INDEX = config.getForkTypes(_srcSlot).BeaconBlockHeader.getPathInfo(statePath).gindex

    const ROOT_INDEX = config.getForkTypes(_srcSlot).BeaconState.getPathInfo(rootPath).gindex
    const RECEIPT_INDEX = config.getForkTypes(_srcSlot).BeaconBlock.getPathInfo(receiptPath).gindex

    const blockRes = await api.beacon.getBlockV2({
      blockId: _srcSlot
    })

    const blockView = config.getForkTypes(_srcSlot).BeaconBlock.toView(blockRes.value().message)

    const blockProof = blockView.createProof([statePath])

    const blockTree = Tree.createFromProof(blockProof)

    const stateRootProof = blockTree.getProof({
      type: ProofType.single,
      gindex: STATE_INDEX
    })

    const stateRes = await api.debug.getStateV2({
      stateId: _srcSlot
    })
    const stateView = config.getForkTypes(_srcSlot).BeaconState.toView(stateRes.value())

    const stateProof = stateView.createProof([rootPath])

    const stateTree = Tree.createFromProof(stateProof)

    const rootProof = stateTree.getProof({
      type: ProofType.single,
      gindex: ROOT_INDEX
    })

    const oldBlockRes = await api.beacon.getBlockV2({
      blockId: _targetSlot
    })

    const oldBlockView = config.getForkTypes(_srcSlot).BeaconBlock.toView(oldBlockRes.value().message)

    const oldBlockProof = oldBlockView.createProof([receiptPath])

    const oldBlockTree = Tree.createFromProof(oldBlockProof)

    const receiptProof = oldBlockTree.getProof({
      type: ProofType.single,
      gindex: RECEIPT_INDEX
    })

    receiptsRootProof = receiptProof.witnesses
      .concat(rootProof.witnesses)
      .concat(stateRootProof.witnesses)
      .map(bytesToHex)
    receiptsRoot = toHexString(receiptProof.leaf)
  } else {
    throw Error('slots are too far')
  }
  return { receiptsRootProof, receiptsRoot }
}

// copied from here: https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/vm/src/runBlock.ts
export const encodeReceipt = (receipt, txType) => {
  const encoded = RLP.encode([
    receipt.stateRoot ?? (receipt.status === 0 ? Uint8Array.from([]) : hexToBytes('0x01')),
    bigIntToBytes(receipt.cumulativeBlockGasUsed),
    receipt.bitvector,
    receipt.logs
  ])

  if (txType === TransactionType.Legacy) {
    return encoded
  }

  // Serialize receipt according to EIP-2718:
  // `typed-receipt = tx-type || receipt-data`
  return concatBytes(intToBytes(txType), encoded)
}

export const getReceiptProof = async (_hash, _client) => {
  const receipt = await _client.getTransactionReceipt({ hash: _hash })
  const block = await _client.getBlock({ blockNumber: receipt.blockNumber })
  const receipts = []
  for (const hash of block.transactions) {
    receipts.push(await _client.getTransactionReceipt({ hash }))
  }

  const trie = new Trie()
  const encodedReceipts = receipts.map((_receipt) => {
    let type = 0
    if (_receipt.type == 'eip2930') {
      type = 1
    } else if (_receipt.type == 'eip1559') {
      type = 2
    } else if (_receipt.type == 'eip4844') {
      type = 3
    } else if (_receipt.type != 'legacy') {
      throw Error(`Unknown receipt type ${_receipt.type}`)
    }

    return encodeReceipt(
      {
        bitvector: fromHexString(_receipt.logsBloom),
        cumulativeBlockGasUsed: BigInt(_receipt.cumulativeGasUsed),
        logs: _receipt.logs.map((_log) => {
          return [
            fromHexString(_log.address),
            _log.topics.map((_topic) => fromHexString(_topic)),
            fromHexString(_log.data)
          ]
        }),
        status: _receipt.status === 'success' ? 1 : 0
      },
      type
    )
  })

  await Promise.all(
    receipts.map((_receipt, _index) => trie.put(RLP.encode(_receipt.transactionIndex), encodedReceipts[_index]))
  )
  const receiptKey = RLP.encode(receipt.transactionIndex)

  const root = toHexString(trie.root())
  if (root !== block.receiptsRoot) {
    throw Error('The trie.root() and block.receiptsRoot do not match')
  }

  return { receiptProof: (await trie.createProof(receiptKey)).map(bytesToHex), receiptsRoot: block.receiptsRoot }
}

// refer from https://github.com/metacraft-labs/DendrETH/blob/main/relay/implementations/beacon-api.ts
export const fetchBlockHeaderProof = async (slot, _sourceChain, _urls) => {
  let chainConfig
  let api
  let config
  console.log(_sourceChain.id)
  ;({ api, config, chainConfig } = getBeaconApi(_sourceChain, chainConfig, _urls))

  const currentBlock = await api.beacon.getBlockV2({
    blockId: slot
  })

  const beaconBlock = currentBlock

  const beaconBlockView = config.getForkTypes(slot).BeaconBlock.toView(currentBlock.value().message)

  const beaconBlockTree = new Tree(beaconBlockView.node)

  const beaconBlockHeader = (await api.beacon.getBlockHeader({ blockId: slot })).value()
  const beaconBlockHeaderView = config.getForkTypes(slot).BeaconBlockHeader.toViewDU(beaconBlockHeader.header.message)

  const beaconBlockHeaderTree = new Tree(beaconBlockHeaderView.node)

  const bodyRootProof = beaconBlockHeaderTree
    .getSingleProof(config.getForkTypes(slot).BeaconBlockHeader.getPathInfo(['body_root']).gindex)
    .map(bytesToHex)

  const BLOCK_NUMBER_INDEX = config
    .getForkTypes(slot)
    .BeaconBlock.getPathInfo(['body', 'execution_payload', 'block_number']).gindex

  const BLOCK_HASH_INDEX = config
    .getForkTypes(slot)
    .BeaconBlock.getPathInfo(['body', 'execution_payload', 'block_hash']).gindex

  const blockNumberProof = beaconBlockTree.getSingleProof(BLOCK_NUMBER_INDEX).map(bytesToHex)

  const blockHashProof = beaconBlockTree.getSingleProof(BLOCK_HASH_INDEX).map(bytesToHex)

  return {
    slot,
    blockNumber: currentBlock.value().message.body.executionPayload.blockNumber,
    blockNumberProof: [...blockNumberProof, ...bodyRootProof],
    blockHash: bytesToHex(currentBlock.value().message.body.executionPayload.blockHash),
    blockHashProof: [...blockHashProof, ...bodyRootProof]
  }
}

export function getBeaconApi(_sourceChain, chainConfig, _urls) {
  switch (_sourceChain.id) {
    case sepolia.id:
      chainConfig = sepoliaChainConfig
      break
    case gnosisChiado.id:
      chainConfig = chiadoChainConfig
      break
    case mainnet.id:
      chainConfig = mainnetChainConfig
      break
    case gnosis.id:
      chainConfig = gnosisChainConfig
      break
    default:
      chainConfig = sepoliaChainConfig
      break
  }

  const config = createChainForkConfig(createChainConfig(chainConfig))

  const api = getClient(
    {
      urls: _urls
    },
    {
      config
    }
  )
  return { api, config, chainConfig }
}
