import { WebSocket } from 'ws'

import { Provider } from '@blaze-cardano/query'

import { 
  PlutusLanguageVersion,
  Address,
  AssetId,
  PolicyId,
  AssetName,
  Datum,
  DatumHash,
  HexBlob,
  PlutusData,
  TransactionId,
  TransactionInput,
  TransactionOutput,
  TransactionUnspentOutput,
  Value,
  ExUnits,
  Redeemers,
  RedeemerPurpose,
  RedeemerTag
 } from "@blaze-cardano/core"

const TESTNET_ID = 42

BigInt.prototype.toJSON = function () {
  return Number(this);
}

export class BlazeProviderFrontend extends Provider {

  constructor(url, debug=false) {
    super(TESTNET_ID)
    this.url = url
    this.nextId = 0
    this.queue = {}
    this.debug = debug
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
        tokenMap.set(AssetId.fromParts(PolicyId(parts[0]), AssetName(parts[1])), BigInt(quantity))
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

  serializeUtxos(unspentOutputs) {
    if (this.debug) {
      console.log("Frontend::serializeUtxos")
    }
    return unspentOutputs.map((output) => {
      const out = output.output()
      const address = out.address().toBech32()
      const ada = out.amount().coin().valueOf()
      const value = { ada: { lovelace: ada } }
      const multiAsset = out.amount().multiasset?.()
      multiAsset?.forEach((assets, assetId) => {
        const policyID = AssetId.getPolicyId(assetId)
        const assetName = AssetId.getAssetName(assetId)
        value[policyID] ?? (value[policyID] = {})
        value[policyID][assetName] = assets
      })
      const datumHash = out.datum()?.asDataHash()?.toString()
      const datum = out.datum()?.asInlineData()?.toCbor()
      const scriptRef = out.scriptRef()
      let script
      if (scriptRef) {
        const langIndex = scriptRef.language()
        const language = _Kupmios.plutusVersions[langIndex - 1]
        script = {
          language: language || "native",
          cbor: langIndex === 0 ? scriptRef.toCbor() : scriptRef[`asPlutusV${langIndex}`]().rawBytes()
        }
      }
      return {
        transaction: {
          id: output.input().transactionId().toString()
        },
        index: Number(output.input().index()),
        address,
        value,
        datumHash,
        datum,
        script
      }
    })
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

  fromDevnetLanguageVersion(x) {
    if (x === "plutus:v1") return PlutusLanguageVersion.V1
    if (x === "plutus:v2") return PlutusLanguageVersion.V2
    if (x === "plutus:v3") return PlutusLanguageVersion.V3
    throw new Error("Unknown plutus language version")
  }

  async getParameters() {
    const obj = await this.query({
      method: "queryProtocolParameters"
    })
    const costModels = new Map()
    //const lengths = [166, 175, 179]
    let i = 0
    for (const [key, value] of Object.entries(obj.plutusCostModels)) {
      costModels.set(this.fromDevnetLanguageVersion(key), value) //.slice(0, lengths[i]))
      i = i + 1
    }
    const parseRatio = (ratio) => {
      const [numerator, denominator] = ratio.split("/").map(Number)
      return numerator / denominator
    }
    const ret = {
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
      costModels,
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
      minFeeReferenceScripts: obj.minFeeReferenceScripts
    } 
    return ret
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

  async getUnspentOutputByNFT(unit) {
    if (this.debug) {
      console.log("Frontend::getUnspentOutputByNFT")
    }
  }

  async resolveUnspentOutputs(txIns) {
    const query = {
      method: "resolveUtxos",
      params: {
        txins: txIns.map(txIn => {
          return txIn.transactionId() + "#" + txIn.index()
        })
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

  resolveDatum(datumHash) {
    if (this.debug) {
      console.log("Frontend::resolveDatum")
    }
  }

  resolveScriptRef(script, address) {
    if (this.debug) {
      console.log("Frontend::resolveScriptRef")
    }
  }

  purposeToTag(key) {
    if (RedeemerPurpose.spend) return RedeemerTag.Spend
    if (RedeemerPurpose.mint) return RedeemerTag.Mint
    if (RedeemerPurpose.certificate) return RedeemerTag.Cert
    if (RedeemerPurpose.withdrawal) return RedeemerTag.Reward
    if (RedeemerPurpose.vote) return RedeemerTag.Voting
    if (RedeemerPurpose.propose) return RedeemerTag.Proposing
  }

  async evaluateTransaction(tx, additionalUtxos) {
    // Quick fail if no redeemers
    const redeemers = tx.witnessSet().redeemers().values()
    if (!redeemers) {
      throw new Error("Cannot evaluate without redeemers!")
    }    

    //const additional_utxos = this.serializeUtxos(additionalUtxos)
    const query = {
      method: "evaluateTx",
      params: {
        cbor: tx.toCbor()
        //utxos: additional_utxos
      }
    }
    const res = await this.query(query)

    const updatedRedeemers = res.map(redeemerData => {
      const exUnits = ExUnits.fromCore({
        memory: redeemerData.budget.memory,
        steps: redeemerData.budget.cpu,
      })

      const redeemer = redeemers.find(x => Number(x.index()) === redeemerData.validator.index &&
        // TODO: RedeemerPurpose enum's indexes are still inconsistent. They are not the same as RedeemerTag values.
        x.tag() === this.purposeToTag(redeemerData.validator.purpose)
      ) 

      if (!redeemer) {
        throw new Error("endpoint returned extraneous redeemer data")
      }

      redeemer.setExUnits(exUnits);
      return redeemer.toCore();
    })

    return Redeemers.fromCore(updatedRedeemers)
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
