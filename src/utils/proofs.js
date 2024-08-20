import { ssz } from '@lodestar/types'
import { ProofType, createProof } from '@chainsafe/persistent-merkle-tree'
import { TransactionType } from '@ethereumjs/tx'
import { hexToBytes, concatBytes, bigIntToBytes, intToBytes } from '@ethereumjs/util'
import { toHexString, fromHexString } from '@chainsafe/ssz'
import { RLP } from '@ethereumjs/rlp'
import { Trie } from '@ethereumjs/trie'
import { bytesToHex } from 'viem'

const SLOTS_PER_HISTORICAL_ROOT = 8192

export const toStringFromBeaconId = (identifier) => {
  if (identifier instanceof Uint8Array) {
    return toHexString(identifier)
  }
  return identifier.toString()
}

export const getState = async (_stateId, _client) => {
  const { data } = await _client.get(`/eth/v2/debug/beacon/states/${toStringFromBeaconId(_stateId)}`)
  if (data.version === 'bellatrix')
    return {
      state: ssz.bellatrix.BeaconState.fromJson(data.data),
      version: 'bellatrix'
    }
  return {
    state: ssz.capella.BeaconState.fromJson(data.data),
    version: 'capella'
  }
}

export const getHeader = async (_blockId, _client) => {
  const { data } = await _client.get(`/eth/v1/beacon/headers/${toStringFromBeaconId(_blockId)}`)
  return ssz.phase0.BeaconBlockHeader.fromJson(data.data.header.message)
}

export const getReceiptsRootProof = async (_srcBlockId, _targetBlockId, _client) => {
  const { state: srcState, version: srcVersion } = await getState(toStringFromBeaconId(_srcBlockId), _client)
  const { state: targetState, version: targetVersion } = await getState(toStringFromBeaconId(_targetBlockId), _client)

  const srcView = ssz[srcVersion].BeaconState.toView(srcState)
  const targetView = ssz[targetVersion].BeaconState.toView(targetState)
  const srcSlot = srcState.slot
  const targetSlot = targetState.slot

  const srcHeader = await getHeader(_srcBlockId, _client)
  const srcHeaderView = ssz.phase0.BeaconBlockHeader.toView(srcHeader)

  let receiptsRootProof
  let receiptsRoot
  if (srcSlot == targetSlot) {
    const receiptGindex = ssz[targetVersion].BeaconState.getPathInfo([
      'latestExecutionPayloadHeader',
      'receiptsRoot'
    ]).gindex
    const receiptProof = createProof(targetView.node, {
      type: ProofType.single,
      gindex: receiptGindex
    })
    receiptsRootProof = receiptProof.witnesses.map(toHexString)
    receiptsRoot = toHexString(receiptProof.leaf)
  } else if (srcSlot - targetSlot < 8192) {
    const headerGindex = ssz.phase0.BeaconBlockHeader.getPathInfo(['stateRoot']).gindex
    const headerProof = createProof(srcHeaderView.node, {
      type: ProofType.single,
      gindex: headerGindex
    })

    const stateRootGindex = ssz[targetVersion].BeaconState.getPathInfo([
      'stateRoots',
      targetSlot % SLOTS_PER_HISTORICAL_ROOT
    ]).gindex
    const proof = createProof(srcView.node, {
      type: ProofType.single,
      gindex: stateRootGindex
    })

    const receiptGindex = ssz[targetVersion].BeaconState.getPathInfo([
      'latestExecutionPayloadHeader',
      'receiptsRoot'
    ]).gindex
    const receiptProof = createProof(targetView.node, {
      type: ProofType.single,
      gindex: receiptGindex
    })
    receiptsRootProof = receiptProof.witnesses.concat(proof.witnesses).concat(headerProof.witnesses).map(toHexString)
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
