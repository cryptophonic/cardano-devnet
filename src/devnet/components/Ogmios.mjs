import { WebSocket } from 'ws'
import { EventEmitter } from 'events'

export { OgmiosStateMachine, OgmiosSynchronousRequestHandler }

class OgmiosStateMachine extends EventEmitter {

  constructor(port) {
    super()
    this.ogmiosServer = new WebSocket("ws://localhost:" + port)
    this.nextId = 0

    this.ogmiosServer.once('open', async () => {
      this.init()
    })

    this.ogmiosServer.on('message', msg => {
      const response = JSON.parse(msg)
      if (this[response.method] !== undefined) {
        // Send to the response method
        this[response.method](response)
      }
    })
  }

  send(jsonRpcObj) {
    jsonRpcObj.jsonrpc = "2.0"
    jsonRpcObj.id = this.nextId++
    this.ogmiosServer.send(JSON.stringify(jsonRpcObj))
    return jsonRpcObj.id
  }

  async init(ogmios) {
    // Initiate sync and mempool monitoring
    this.send({
      method: "findIntersection",
      params: {
        points: ["origin"]
      }
    })
    this.send({
      method: "acquireMempool"
    })
  }

  findIntersection(msg) {
    this.send({
      method: "nextBlock"
    })
  }

  nextBlock(msg) {
    if (msg.result.block !== undefined) {
      this.emit('block', msg.result.block)
    }
    this.send({
      method: "nextBlock"
    })
  }

  acquireMempool(msg) {
    this.send({
      method: "nextTransaction",
      params: {
        fields: "all"
      }
    })
    this.emit('mempoolStart')
  }

  releaseMempool(msg) {
    this.emit('mempoolStop')
    setTimeout(() => {
      this.send({
        method: "acquireMempool"
      })
    }, 1000)
  }

  nextTransaction(msg) {
    if (msg.result.transaction === null) {
      this.send({
        method: "releaseMempool"
      })
    } else {
      this.emit('transaction', msg.result.transaction)
      this.send({
        method: "nextTransaction",
        params: {
          fields: "all"
        }
      })
    }
  }

}

class OgmiosSynchronousRequestHandler {

  constructor(port) {
    this.ogmiosServer = new WebSocket("ws://localhost:" + port)
    this.nextId = 0
    this.pending = {}

    this.ogmiosServer.on('message', msg => {
      const obj = JSON.parse(msg)
      if (this.pending[obj.id] !== undefined) {
        this.pending[obj.id](obj)
        delete this.pending[obj.id]
      }
    })
  }

  send(jsonRpcObj) {
    jsonRpcObj.jsonrpc = "2.0"
    jsonRpcObj.id = this.nextId++
    const request = JSON.stringify(jsonRpcObj)
    this.ogmiosServer.send(request)
    return jsonRpcObj.id
  }

  handleResponse(obj) {
    if (this.pending[obj.id] !== undefined) {
      this.pending[obj.id](obj)
      delete this.pending[obj.id]
    }
  }

  async acquireLedgerState() {
    const obj = await new Promise(resolve => {
      const id = this.send({
        method: "acquireLedgerState",
        params: {
          point: {
            slot: currentSlot,
            id: currentBlockHash
          }
        }
      })
      this.pending[id] = resolve
    })
    if (obj.result.acquired === "ledgerState") {
      return true
    } else {
      throw Error("Failed to acquire ledger state")
    }
  }

  async releaseLedgerState() {
    this.send({
      method: "releaseLedgerState"
    })
  }

  async queryProtocolParameters() {
    const obj = await new Promise(resolve => {
      const id = this.send({
        method: "queryLedgerState/protocolParameters"
      })
      this.pending[id] = resolve
    })
    return obj.result
  }

  async evaluateTx(cbor, utxos) {
    const obj = await new Promise(resolve => {
      const request = {
        method: "evaluateTransaction",
        params: {
          transaction: {
            cbor: cbor
          },
          additionalUtxo: utxos
        }
      }
      const id = this.send(request)
      this.pending[id] = resolve
    })
    if (obj.error !== undefined) {
      console.log(JSON.stringify(obj.error))
      throw Error(obj.error.message)
    }
    return obj.result
  }

  async submitTx(cbor) {
    const obj = await new Promise(resolve => {
      const id = this.send({
        method: "submitTransaction",
        params: {
          transaction: {
            cbor: cbor
          }
        }
      })
      this.pending[id] = resolve
    })
    if (obj.error !== undefined) {
      console.error(JSON.stringify(obj.error, null, 2))
      throw Error(obj.error.message)
    }
    return obj.result
  }

}