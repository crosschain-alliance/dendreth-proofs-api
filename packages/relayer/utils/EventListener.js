import { toHex } from 'viem'
import { getLatestLCUpdateLog, waitForServer } from './utils.js'

// 1. Watch for Hash Stored event on DendrETH Adapter with store block header function call
//  (no direct way to check the call, but we can check the HashStored event's id if it is a block number)
// 2. Once get the block number in HashStored, we query the Yaho event from blockNum - maxBlockWindow  to blockNum
// 3. Get the events and push to message_dispatch_event_queue
export default class EventListener {
  logger
  onLogs
  sourceClient
  targetClient
  yahoContractAddress
  dendrethContractAddress
  YahoABI
  DendrETHAdapterABI
  sendToMessageDispatchEventQueue
  _lastBlock
  _watchIntervalTimeMs
  _maxBlockWindow
  _maxEventToProve

  constructor(_configs) {
    this.logger = _configs.logger.child({ service: _configs.service })
    this.sourceClient = _configs.sourceClient
    this.targetClient = _configs.targetClient
    this.yahoContractAddress = _configs.yahoContractAddress
    this.dendrethContractAddress = _configs.dendrethContractAddress
    this.YahoABI = _configs.YahoABI
    this.DendrETHAdapterABI = _configs.DendrETHAdapterABI
    this.onLogs = _configs.onLogs
    this.proverURL = _configs.proverURL
    this.sendToMessageDispatchEventQueue = _configs.sendToMessageDispatchEventQueue
    this._watchIntervalTimeMs = _configs.watchIntervalTimeMs
    this._lastBlock = _configs.queryFromBlock ? _configs.queryFromBlock : '0'
    this._maxBlockWindow = _configs.maxBlockWindow
    this._maxEventToProve = _configs.maxEventToProve
  }

  async start() {
    await waitForServer(this.proverURL)
    try {
      this._watch()
      setInterval(() => {
        this._watch()
      }, this._watchIntervalTimeMs)
    } catch (_err) {
      this.logger.error(_err)
    }
  }

  async _watch() {
    try {
      const currentBlock = await this.targetClient.getBlockNumber()

      if (!this._lastBlock) {
        this._lastBlock = currentBlock - BigInt(this._maxBlockWindow)
      }
      let fromBlock = this._lastBlock
      let toBlock = currentBlock - 1n
      let isBlockRangeMismatch = fromBlock < toBlock ? false : true
      if (isBlockRangeMismatch) {
        // swap if fromBlock > toBlock
        let temp = fromBlock
        fromBlock = toBlock
        toBlock = temp
      }

      this.logger.info(
        `Listening to DendrETH Light Client Update from block ${fromBlock} to block ${toBlock} on ${this.targetClient.chain.name} contract address: ${this.dendrethContractAddress}...`
      )

      let LCUpdateLogs = await this.targetClient.getContractEvents({
        address: this.dendrethContractAddress,
        abi: this.DendrETHAdapterABI,
        eventName: 'HashStored',
        fromBlock: toHex(fromBlock),
        toBlock: toHex(toBlock)
      })

      if (LCUpdateLogs.length) {
        this.logger.info(
          `Detected ${LCUpdateLogs.length} new HashStored events on ${this.targetClient.chain.name}. Processing them ...`
        )

        let latestLCLog = getLatestLCUpdateLog(LCUpdateLogs)

        if (latestLCLog) {
          // find the MessageDispatched event from the source chain
          const messageDispatchedLogs = await this.sourceClient.getContractEvents({
            address: this.yahoContractAddress,
            abi: this.YahoABI,
            eventName: 'MessageDispatched',
            fromBlock: BigInt(latestLCLog.topics[1]) - BigInt(this._maxBlockWindow),
            toBlock: BigInt(latestLCLog.topics[1])
          })

          this.logger.info(
            `Searching for Message Dispatch event from ${
              BigInt(latestLCLog.topics[1]) - BigInt(this._maxBlockWindow)
            } to ${BigInt(latestLCLog.topics[1])} on ${this.sourceClient.chain.name}`
          )

          // Proceed with event proof
          if (messageDispatchedLogs.length) {
            this.logger.info(
              `Found ${messageDispatchedLogs.length} Message Dispatched event on ${this.sourceClient.chain.name}`
            )
            if (messageDispatchedLogs.length > this._maxEventToProve && this._maxEventToProve > 0) {
              // only process maxEventToProve amount of event
              await this.onLogs(
                messageDispatchedLogs.slice(0, this._maxEventToProve),
                this.logger,
                this.sendToMessageDispatchEventQueue
              )
            } else {
              await this.onLogs(messageDispatchedLogs, this.logger, this.sendToMessageDispatchEventQueue)
            }
          }
        }
      } else {
        this.logger.info('No light client update found...')
      }

      this._lastBlock = toBlock
    } catch (_err) {
      this.logger.error(`${_err}`)
    }
  }
}
