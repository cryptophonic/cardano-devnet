import fs from 'fs'
import { CML, PROTOCOL_PARAMETERS_DEFAULT } from '@lucid-evolution/lucid'
import WebSocket from 'ws'

BigInt.prototype["toJSON"] = function () {
  return this.toString() + "n";
}

function replaceAmountsWithBigInt(obj) {
  obj.map(o => {
    o.assets = Object.keys(o.assets).reduce((bcc, k) => {
      bcc[k] = BigInt(o.assets[k])
      return bcc
    }, {})
    return o
  })
  //console.log("1: " + JSON.stringify(obj, null, 2))
  return obj
}

export class LucidProviderFrontend {

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

  async getProtocolParameters() {
    const obj = await this.query({
      method: "queryProtocolParameters"
    })
    const def = PROTOCOL_PARAMETERS_DEFAULT
    def.costModels = []
    def.costModels.PlutusV1 = obj.plutusCostModels["plutus:v1"]
    def.costModels.PlutusV2 = [] 
    for (let i = 0; i <= 174; i++) {
      def.costModels.PlutusV2[i] = obj.plutusCostModels["plutus:v2"][i]
    }
    def.costModels.PlutusV3 = obj.plutusCostModels["plutus:v3"]
    return def
  }

  async waitBlock() {
    await this.query({
      method: "waitBlock"
    })
  }

  async getUtxos(addressOrCredential) {
    if (typeof addressOrCredential === "string") {
      const obj = await this.query({
        method: "getUtxos",
        params: {
          address: addressOrCredential
        }
      })
      return replaceAmountsWithBigInt(obj)
    } else {
      const credentialBech32 = addressOrCredential.type === "Key"
        ? CML.Ed25519KeyHash.from_hex(addressOrCredential.hash).to_bech32("addr_test") :
        CML.ScriptHash.from_hex(addressOrCredential.hash).to_bech32("addr_test")
      const obj = await this.query({
        method: "getUtxos",
        params: {
          credential: credentialBech32
        }
      })
      return replaceAmountsWithBigInt(obj)
    }
  }

  async getUtxosWithUnit(addressOrCredential, unit) {
    if (typeof addressOrCredential === "string") {
      const obj = await this.query({
        method: "getUtxosWithUnit",
        params: {
          address: addressOrCredential,
          unit: unit
        }
      })
      return replaceAmountsWithBigInt(obj)
    } else {
      const credentialBech32 = addressOrCredential.type === "Key"
        ? CML.Ed25519KeyHash.from_hex(addressOrCredential.hash).to_bech32("addr_test") :
        CML.ScriptHash.from_hex(addressOrCredential.hash).to_bech32("addr_test")
      const obj = await this.query({
        method: "getUtxosWithUnit",
        params: {
          credential: credentialBech32,
          unit: unit
        }
      })
      return replaceAmountsWithBigInt(obj)
    }
  }

  async getUtxosByOutRef(outrefs) {
    const obj = await this.query({
      method: "getUtxosByOutRef",
      params: {
        outrefs: outrefs
      }
    })
    return obj
  }

  async submitTx(tx) {
    return await this.query({
      method: "submitTx",
      params: {
        cbor: tx
      }
    })
  }

} 

