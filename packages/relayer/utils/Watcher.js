class Watcher {
  logger
  onLogs
  client
  contractAddress
  abi
  eventName
  _lastBlock
  _watchIntervalTimeMs

  constructor(_configs) {
    this.logger = _configs.logger.child({ service: _configs.service })
    this.client = _configs.client
    this.contractAddress = _configs.contractAddress
    this.abi = _configs.abi
    this.eventName = _configs.eventName
    this.onLogs = _configs.onLogs
    this._watchIntervalTimeMs = _configs.watchIntervalTimeMs

    this._lastBlock = 0n
  }

  async start() {
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
      const currentBlock = await this.client.getBlockNumber()
      if (!this._lastBlock) {
        this._lastBlock = currentBlock - 1n
      }

      const fromBlock = this._lastBlock + 1n
      const toBlock = currentBlock
      this.logger.info(
        ` ${this.eventName} events from block ${fromBlock} to block ${toBlock} on ${this.client.chain.name} , contract ${this.contractAddress}...`
      )

      const logs = await this.client.getContractEvents({
        address: this.contractAddress,
        abi: this.abi,
        eventName: this.eventName,
        fromBlock,
        toBlock
      })
      this.logger.info(`The log  ${logs.length}`)

      if (logs.length) {
        this.logger.info(
          `Detected ${logs.length} new ${this.eventName} events on ${this.client.chain.name}. Processing them ...`
        )
        await this.onLogs(logs)
        this.logger.info('Events succesfully processed.')
      }

      this._lastBlock = currentBlock
    } catch (_err) {
      this.logger.error(`${_err}`)
    }
  }
}

export default Watcher
