import fs from 'fs'
import { WebSocketServer } from 'ws'
import { OgmiosStateMachine } from './components/Ogmios.mjs'

const OGMIOS_PORT = 1337
const PROVIDER_PORT = 1338

class ProviderBackend {

  constructor(port) {
    this.server = new WebSocketServer({ port: port })
    this.osm = new OgmiosStateMachine(OGMIOS_PORT)

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
            sock.send(JSON.stringify({
              jsonrpc: "2.0",
              error: err.message,
              id: request.id
            }))
          }
        }
      })
    })
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

}

new ProviderBackend(PROVIDER_PORT)
