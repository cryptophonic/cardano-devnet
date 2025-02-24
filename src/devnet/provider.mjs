import fs from 'fs'
import { WebSocketServer } from 'ws'
import { OgmiosStateMachine, OgmiosSynchronousRequestHandler } from './components/Ogmios.mjs'

const OGMIOS_PORT = 1337
const PROVIDER_PORT = 1338

class ProviderBackend {

  constructor(port) {
    this.server = new WebSocketServer({ port: port })
    this.osm = new OgmiosStateMachine(OGMIOS_PORT)
    this.osrh = new OgmiosSynchronousRequestHandler(OGMIOS_PORT)

    this.server.on('connection', sock => {
      sock.on('message', async msg => {
        const request = JSON.parse(msg.toString())
        if (request.jsonrpc !== "2.0") {
          this.providerError(sock, request.id, "invalid jsonrpc version")
        } else if (this[request.method] === undefined) {
          this.providerError(sock, request.id, "invalid request method")
        } else {
          try {
            const result = await this[request.method](request.params)
            sock.send(JSON.stringify({
              jsonrpc: "2.0",
              method: request.method,
              result: result,
              id: request.id
            }))
          } catch (err) {
            console.error(err.stack)
            this.providerError(sock, err.message, request.id)
          }
        }
      })
    })

    this.indexPath = process.env.DEVNET_ROOT + "/runtime/index"
  }

  providerError(sock, id, msg) {
    sock.send(JSON.stringify({
      jsonrpc: "2.0",
      error: msg,
      id: id
    }))
  }

  // Simply waits for the next block before it returns. Useful for synchronizing bash
  // scripts or other sequencing transactions
  async waitBlock() {    
    const res = await new Promise(resolve => {
      this.osm.once('block', block => {
        resolve(block)
      })
    })
    return {
      hash: res.id, 
      height: res.height
    }
  }

  async queryProtocolParameters() {
    return await this.osrh.queryProtocolParameters()
  }

  async getUtxos(params) {
    const address = params.address
    const unspentPath = this.indexPath + "/addresses/" + address + "/unspent"
    let unspent = []
    if (fs.existsSync(unspentPath)) {
      const unspentRefList = JSON.parse(fs.readFileSync(unspentPath))
      unspent = unspentRefList.map(ref => {
        const [ hash, index ] = ref.split("#")
        const outputPath = this.indexPath + "/transactions/" + hash + "/outputs/" + index + "/output"
        const outputData = JSON.parse(fs.readFileSync(outputPath))
        const assetList = Object.keys(outputData.value).reduce((acc, policy) => {
          if (policy === "ada") {
            acc["lovelace"] = outputData.value[policy]["lovelace"]
          } else {
            acc[outputData.value[policy]].map(name => {
              const unit = policy + "." + name
              acc[unit] = outputData.value[policy[name]]
            })
          }
          return acc
        }, {})
        return {
          txHash: hash,
          outputIndex: index,
          assets: assetList,
          address: outputData.address
        }
      })
    }
    return unspent
  }

  async getUtxosWithUnit(params) {
    const address = params.address
    const unspentPath = this.indexPath + "/addresses/" + address + "/unspent"
    let unspent = []
    // TBD
    return unspent
  }

  async submitTx(params) {
    const res = await this.osrh.submitTx(params.cbor)
    return res.transaction.id
  }

}

new ProviderBackend(PROVIDER_PORT)
