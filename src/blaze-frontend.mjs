import { WebSocket } from 'ws'

import { Provider } from '@blaze-cardano/query'
import { Core } from '@blaze-cardano/sdk'

import { 
  PlutusLanguageVersion,
  Address,
  AssetId,
  Datum,
  DatumHash,
  HexBlob,
  PlutusData,
  TransactionId,
  TransactionInput,
  TransactionOutput,
  TransactionUnspentOutput,
  Value,
  toHex
 } from "@blaze-cardano/core"

const TESTNET_ID = 42

export class BlazeProviderFrontend extends Provider {

  constructor(url) {
    super(TESTNET_ID)
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
        throw Error("Provider error: " + err.message)
      }
      this.sock.onmessage = async msg => {
        const obj = JSON.parse(msg.data)
        if (this.queue[obj.id] !== undefined) {
          if (obj.error !== undefined) {
            throw Error(obj.error)
          } else {
            await this.queue[obj.id](obj.result)
          }
          delete this.queue[obj.id]
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

  buildTransactionUnspentOutput(utxo) {
    const txIn = new TransactionInput(
      TransactionId(utxo.txHash),
      BigInt(utxo.outputIndex)
    )
    // No tx output CBOR available
    // so TransactionOutput must be manually constructed.
    const tokenMap = new Map
    let lovelace = 0n;
    Object.keys(utxo.assets).map(k => {
      const quantity = utxo.assets[k]
      if (k === "lovelace") {
        lovelace = BigInt(quantity)
      } else {
        const parts = k.split(".")
        tokenMap.set(AssetId(parts[0] + parts[1]), BigInt(quantity))
      }
    })
    const txOut = new TransactionOutput(
      Address.fromBech32(utxo.address),
      new Value(lovelace, tokenMap),
    )
    if (utxo.datum !== undefined) {
      const datum = Datum.newInlineData(PlutusData.fromCbor(HexBlob(utxo.datum)))
      txOut.setDatum(datum)
    } else if (utxo.datumHash !== undefined) {
      const datum = Datum.newDataHash(DatumHash(utxo.datumHash))
      txOut.setDatum(datum)
    }
    if (utxo.scriptRef !== undefined) {
      txOut.setScriptRef()
    }
    return new TransactionUnspentOutput(txIn, txOut)
  }

  async waitBlock() {
    return await this.query({
      method: "waitBlock"
    })
  }

  async awaitTransactionConfirmation(txId, timeout) {
    return await this.query({
      method: "waitTransaction",
      params: {
        id: txId,
        timeout: timeout
      }
    })
  }

  async getParameters() {
    const obj = await this.query({
      method: "queryProtocolParameters"
    })
    const costModels = new Map()
    Object.keys(obj.plutusCostModels).map(cm => {
      let key = PlutusLanguageVersion.V1
      if (cm === "plutus:v1") key = PlutusLanguageVersion.V1
      if (cm === "plutus:v2") key = PlutusLanguageVersion.V2
      if (cm === "plutus:v3") key = PlutusLanguageVersion.V3
      costModels.set(key, obj.plutusCostModels[cm])
    })
    const parseRatio = (ratio) => {
      const [numerator, denominator] = ratio.split("/").map(Number)
      return numerator / denominator
    }
    return {
      coinsPerUtxoByte: obj.minUtxoDepositCoefficient,
      maxTxSize: obj.maxTransactionSize.bytes,
      minFeeCoefficient: obj.minFeeCoefficient,
      minFeeConstant: obj.minFeeConstant.ada.lovelace,
      maxBlockBodySize: obj.maxBlockBodySize.bytes,
      maxBlockHeaderSize: obj.maxBlockHeaderSize.bytes,
      stakeKeyDeposit: obj.stakeCredentialDeposit.ada.lovelace,
      poolDeposit: obj.stakePoolDeposit.ada.lovelace,
      poolRetirementEpochBound: obj.stakePoolRetirementEpochBound,
      desiredNumberOfPools: obj.desiredNumberOfStakePools,
      poolInfluence: obj.stakePoolPledgeInfluence,
      monetaryExpansion: obj.monetaryExpansion,
      treasuryExpansion: obj.treasuryExpansion,
      minPoolCost: obj.minStakePoolCost.ada.lovelace,
      protocolVersion: obj.version,
      maxValueSize: obj.maxValueSize.bytes,
      collateralPercentage: obj.collateralPercentage,
      maxCollateralInputs: obj.maxCollateralInputs,
      costModels: costModels,
      prices: {
        memory: parseRatio(obj.scriptExecutionPrices.memory),
        steps: parseRatio(obj.scriptExecutionPrices.cpu),
      },
      maxExecutionUnitsPerTransaction: {
        memory: obj.maxExecutionUnitsPerTransaction.memory,
        steps: obj.maxExecutionUnitsPerTransaction.cpu,
      },
      maxExecutionUnitsPerBlock: {
        memory: obj.maxExecutionUnitsPerBlock.memory,
        steps: obj.maxExecutionUnitsPerBlock.cpu,
      },
    } 
  }

  async getUnspentOutputs(address) {
    const query = {
      method: "getUtxos",
      params: {
        address: address.toBech32()
      }
    }
    const obj = await this.query(query)
    const utxos = obj.map(utxo => {
      const assetList = Object.keys(utxo.assets).reduce((acc, policy) => {
        if (policy === "ada") {
          acc["lovelace"] = utxo.assets[policy]["lovelace"]
        } else {
          Object.keys(utxo.assets[policy]).map(name => {
            const unit = policy + "." + name
            acc[unit] = utxo.assets[policy][name]
          })
        }
        return acc
      }, {})
      utxo.assets = assetList
      return this.buildTransactionUnspentOutput(utxo)
    })
    return utxos
  }

  async getUnspentOutputsWithAsset(address, unit) {
    const query = {
      method: "getUtxosWithUnit",
      params: {
        address: address.toBech32(),
        policyId: AssetId.getPolicyId(unit),
        tokenName: AssetId.getAssetName(unit)
      }
    }
    const obj = await this.query(query)
    const utxos = obj.map(utxo => {
      const assetList = Object.keys(utxo.assets).reduce((acc, policy) => {
        if (policy === "ada") {
          acc["lovelace"] = utxo.assets[policy]["lovelace"]
        } else {
          Object.keys(utxo.assets[policy]).map(name => {
            const unit = policy + "." + name
            acc[unit] = utxo.assets[policy][name]
          })
        }
        return acc
      }, {})
      utxo.assets = assetList
      return this.buildTransactionUnspentOutput(utxo)
    })
    return utxos
  }

  async evaluateTransaction(tx, additionalUtxos) {
    console.log(JSON.stringify(additionalUtxos))
    const query = {
      method: "evaluateTx",
      params: {
        cbor: tx.toCbor()
      }
    }
    const res = await this.query(query)
    return res
  }

  async postTransactionToChain(tx) {
    const query = {
      method: "submitTx",
      params: {
        cbor: tx.toCbor()
      }
    }
    const txid = await this.query(query)
    return TransactionId(txid)
  }

}

const main = async () => {
  const provider = new BlazeProviderFrontend("ws://localhost:1338")
  await provider.init()

  //console.log("Waiting for block...")
  //const block = await provider.waitBlock()
  //console.log("Block received: height=" + block.height)
  //const params = await provider.getParameters()
  //console.log(JSON.stringify(params, null, 2))
  //const outputs = await provider.getUnspentOutputs(Core.addressFromBech32(
    //"addr_test1vztc80na8320zymhjekl40yjsnxkcvhu58x59mc2fuwvgkc332vxv"
  //))
  const outputs = await provider.getUnspentOutputsWithAsset(
    Core.addressFromBech32("addr_test1vztc80na8320zymhjekl40yjsnxkcvhu58x59mc2fuwvgkc332vxv"),
    AssetId.fromParts("2e03063c4f133ec23b2467b3eccb7c4f433b06264d3ba893bcb72d7f",
      toHex(Buffer.from("counter-token", "utf8"))
    )
  )
  console.log(JSON.stringify(outputs, null, 2))
  for (let i=0; i<outputs.length; i++) {
    console.log(outputs[i].toCbor())
  }

  process.exit()
}

//main()

/*
    const alwaysTrueScript: Script = Script.newPlutusV2Script(
      new PlutusV2Script(HexBlob("510100003222253330044a229309b2b2b9a1")),
    );
    const scriptAddress = addressFromValidator(
      NetworkId.Testnet,
      alwaysTrueScript,
    );
    const output = new TransactionOutput(
      scriptAddress,
      value.makeValue(1_000_000n),
    );
*/
