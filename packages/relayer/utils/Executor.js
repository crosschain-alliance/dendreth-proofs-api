class Executor {
  logger
  client
  contractAddress
  abi
  functionName
  database
  account
  _watchIntervalTimeMs

  constructor(_configs) {
    this.logger = _configs.logger.child({ service: _configs.service })
    this.client = _configs.client
    this.contractAddress = _configs.contractAddress
    this.abi = _configs.abi
    this.eventName = _configs.eventName
    this.database = _configs.database
    this.account = _configs.account
    this._watchIntervalTimeMs = _configs.watchIntervalTimeMs
  }

  async start() {
    try {
      this._processEvents()
      setInterval(() => {
        this._processEvents()
      }, this._watchIntervalTimeMs)
    } catch (_err) {
      this.logger.error(_err)
    }
  }

  async _processEvents() {
    // get database with status 'pendingBlockToFinalize' & retries < 3;
    try {
      const pendingEvents = await db
        .collection('messageDispatchEvents')
        .find({
          status: 'pendingBlockToFinalize',
          retries: { $lt: 3 }
        })
        .toArray()

      this.logger.info(`Processing ${pendingEvents.length} MessageDispatched event(s)`)

      pendingEvents.forEach(async (event) => {
        try {
          const { data: proof } = await axios.get(`${process.env.PROOF_API}/${txHash}`)
          const { request } = await this.client.simulateContract({
            account: privateKeyToAccount(process.env.PRIVATE_KEY),
            abi: this.abi,
            functionName: this.functionName,
            address: this.contractAddress,
            args: proof.proof
          })

          const tx = await targetClient.writeContract(request)
          this.logger.info(`Event proof successfully verified: ${tx} `)

          await db
            .collection('messageDispatchEvents')
            .updateOne({ id: event.id }, { $set: { lastChecked: new Date(), status: 'completed' } })
        } catch (err) {
          await db
            .collection('messageDispatchEvents')
            .updateOne({ id: event.id }, { $inc: { retries: 1 }, $set: { lastChecked: new Date() } })
        }
      })
    } catch (_err) {
      this.logger.error(_err)
    }
  }
}
