import { WebSocket } from 'ws'

class BlazeProviderFrontend {

  constructor(url) {
    this.url = url
    this.nextId = 0
    this.queue = {}
  }

  async init() {
    return new Promise(resolve => {
      this.sock = new WebSocket(this.url)
      this.sock.onopen = () => {
        console.log("Provider connected")
        resolve()
      }
      this.sock.onerror = err => {
        console.log("Provider error: " + err.message)
      }
      this.sock.onmessage = async msg => {
        const obj = JSON.parse(msg.data)
        if (this.queue[obj.id] !== undefined) {
          if (obj.error !== undefined) {
            const err = JSON.parse(obj.error)
            console.error("Error: " + err.message)
            if (err.data !== undefined) {
              console.error(JSON.stringify(err.data, null, 2))
            }
            await this.queue[obj.id](obj.error)
          } else {
            await this.queue[obj.id](obj.result)
            delete this.queue[obj.id]
          }
        }
      }
    })
  }

  async query(obj) {
    obj.jsonrpc = "2.0"
    obj.id = this.nextId++
    this.sock.send(JSON.stringify(obj))
    return new Promise(resolve => {
      this.queue[obj.id] = resolve
    })
  }

  async waitBlock() {
    return await this.query({
      method: "waitBlock"
    })
  }

}

const main = async () => {
  const provider = new BlazeProviderFrontend("ws://localhost:1338")
  await provider.init()

  console.log("Waiting for block...")
  const block = await provider.waitBlock()
  console.log("Block received: height=" + block.height)

  process.exit()
}

main()
