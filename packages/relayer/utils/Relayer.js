class Relayer {
  logger
  onLogs
  sourceClient
  targetClient
  contractAddress
  abi
  eventName
  _lastBlock
  _watchIntervalTimeMs
  _requiredBlockConfirmations
  _blockWindow

  constructor(_configs) {
    this.logger = _configs.logger.child({ service: _configs.service })
    this.sourceClient = _configs.sourceClient
    this.contractAddress = _configs.contractAddress
    this.abi = _configs.abi
    this.eventName = _configs.eventName
    this.onLogs = _configs.onLogs
    this._watchIntervalTimeMs = _configs.watchIntervalTimeMs
    this._requiredBlockConfirmations = BigInt(_configs.requiredBlockConfirmation)
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
      const currentBlock = await this.sourceClient.getBlockNumber()
      this.logger.info(`Current block number: ${currentBlock}`)
      this.logger.info(`Required block confirmations: ${this._requiredBlockConfirmations} blocks`)
      if (!this._lastBlock) {
        this._lastBlock = currentBlock - this._requiredBlockConfirmations - 100n // 100n is block buffer
        this.logger.info(`last block processed: ${this._lastBlock}`)
      }

      let fromBlock = this._lastBlock + 1n
      let toBlock = currentBlock - this._requiredBlockConfirmations
      let isBlockRangeMismatch = fromBlock < toBlock ? false : true
      if (isBlockRangeMismatch) {
        // swap if fromBlock > toBlock
        let temp = fromBlock
        fromBlock = toBlock
        toBlock = temp
      }

      this.logger.info(
        `Listening to ${this.eventName} events from block ${fromBlock} to block ${toBlock} on ${this.sourceClient.chain.name} contract address: ${this.contractAddress}...`
      )

      const logs = await this.sourceClient.getContractEvents({
        address: this.contractAddress,
        abi: this.abi,
        eventName: this.eventName,
        fromBlock,
        toBlock
      })

      if (logs.length) {
        this.logger.info(
          `Detected ${logs.length} new ${this.eventName} events on ${this.sourceClient.chain.name}. Processing them ...`
        )
        await this.onLogs(logs)
        this.logger.info('Events succesfully processed.')
      }

      this._lastBlock = toBlock
    } catch (_err) {
      this.logger.error(`${_err}`)
    }
  }
}

export default Relayer
