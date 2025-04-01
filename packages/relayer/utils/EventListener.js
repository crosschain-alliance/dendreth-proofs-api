import { toHex, hexToNumber } from 'viem'
import axios from 'axios'
import { getLatestLCUpdateLog, waitForServer, filterDestionChainForMessageDispatchedLogs } from './utils.js'

// 1. Watch for Hash Stored event on Adapter with store block header function call
//  (no direct way to check the call, but we can check the HashStored event's id if it is a block number)
// 2. Once get the block number in HashStored, we query the Yaho event from blockNum - maxBlockWindow  to blockNum
// 3. Get the events and push to message_dispatch_event_queue
export default class EventListener {
  lightClientType
  logger
  onLogs
  sourceClient
  targetClient
  yahoContractAddress
  lightClientContractAddress
  YahoABI
  lightClientAdapterABI
  sendToMessageDispatchEventQueue
  _lastBlock
  _watchIntervalTimeMs
  _maxBlockWindow
  _maxEventToProve
  _isWatching = false

  constructor(_configs) {
    this.logger = _configs.logger.child({ service: _configs.service })
    this.lightClientType = _configs.lightClientType
    this.sourceClient = _configs.sourceClient
    this.targetClient = _configs.targetClient
    this.yahoContractAddress = _configs.yahoContractAddress
    this.lightClientContractAddress = _configs.lightClientContractAddress
    this.YahoABI = _configs.YahoABI
    this.lightClientAdapterABI = _configs.lightClientAdapterABI
    this.onLogs = _configs.onLogs
    this.proverURL = _configs.proverURL
    this.sendToMessageDispatchEventQueue = _configs.sendToMessageDispatchEventQueue
    this._watchIntervalTimeMs = _configs.watchIntervalTimeMs
    this._lastBlock = _configs.queryFromBlock
      ? BigInt(_configs.queryFromBlock)
      : this.targetClient.getBlockNumber() - 10n
    this._maxBlockWindow = _configs.maxBlockWindow
    this._maxEventToProve = _configs.maxEventToProve
  }

  async start() {
    await waitForServer(this.proverURL)
    try {
      this._watchLoop()
    } catch (_err) {
      this.logger.error(_err)
    }
  }

  async _watchLoop() {
    try {
      await this._watch()
    } catch (err) {
      this.logger.error(`Error in _watch: ${err}`)
    } finally {
      // Schedule the next execution after the interval
      setTimeout(() => this._watchLoop(), this._watchIntervalTimeMs)
    }
  }
  async _watch() {
    // Set flag to indicate we're currently watching
    this._isWatching = true

    try {
      const currentBlock = await this.targetClient.getBlockNumber()

      if (!this._lastBlock) {
        this._lastBlock = currentBlock - 2n
      }
      let fromBlock = this._lastBlock + 1n
      let toBlock = currentBlock - 1n
      let isBlockRangeMismatch = fromBlock < toBlock ? false : true
      if (isBlockRangeMismatch) {
        // swap if fromBlock > toBlock
        let temp = fromBlock
        fromBlock = toBlock
        toBlock = temp
      }

      this.logger.info(
        `Listening to ${this.lightClientType} Light Client Update from block ${fromBlock} to block ${toBlock} on ${this.targetClient.chain.name} contract address: ${this.lightClientContractAddress}...`
      )

      let eventToListen = this.lightClientType == 'dendreth' ? 'HashStored' : 'HeadUpdate'
      let LCUpdateLogs = await this.targetClient.getContractEvents({
        address: this.lightClientContractAddress,
        abi: this.lightClientAdapterABI,
        eventName: eventToListen,
        fromBlock: toHex(fromBlock),
        toBlock: toHex(toBlock)
      })

      if (LCUpdateLogs.length) {
        this.logger.info(
          `Detected ${LCUpdateLogs.length} new ${eventToListen} events on ${this.targetClient.chain.name}. Processing them ...`
        )

        let latestLCLog = getLatestLCUpdateLog(LCUpdateLogs)

        if (latestLCLog) {
          // for DendrETH, latestLCLog.topics[1] is the block number
          // for Helios, latestLCLog.topics[1] is the slot number, need to find the corresponding block number

          let fromBlock
          let toBlock

          if (this.lightClientType == 'helios') {
            const {
              data: { data }
            } = await axios.get(`${process.env.BEACONCHA_IN_URL}/api/v1/slot/${hexToNumber(latestLCLog.topics[1])}`)

            fromBlock = data.exec_block_number - this._maxBlockWindow
            toBlock = data.exec_block_number
          } else if (this.lightClientType == 'dendreth') {
            fromBlock = BigInt(latestLCLog.topics[1]) - BigInt(this._maxBlockWindow)
            toBlock = BigInt(latestLCLog.topics[1])
          }
          // find the MessageDispatched event from the source chain
          let messageDispatchedLogs = await this.sourceClient.getContractEvents({
            address: this.yahoContractAddress,
            abi: this.YahoABI,
            eventName: 'MessageDispatched',
            fromBlock: toHex(fromBlock),
            toBlock: toHex(toBlock)
          })

          this.logger.info(
            `Searching for Message Dispatch event from ${fromBlock} to ${toBlock} on ${this.sourceClient.chain.name}`
          )

          // filter message dispatch logs with destination chain ID
          messageDispatchedLogs = filterDestionChainForMessageDispatchedLogs(
            messageDispatchedLogs,
            await this.targetClient.getChainId()
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
          } else {
            this.logger.info(
              `No message dispatched event found  from ${fromBlock} to ${toBlock} on ${this.sourceClient.chain.name}`
            )
          }
        } else {
          this.logger.debug(`Latest Hash Stored event is not a store block header event`)
        }
      } else {
        this.logger.info('No light client update found...')
      }

      this._lastBlock = toBlock
    } catch (_err) {
      this.logger.error(`${_err}`)
    } finally {
      // Reset flag when we're done, regardless of success or failure
      this._isWatching = false
    }
  }
}
