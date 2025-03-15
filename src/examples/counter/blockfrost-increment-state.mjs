import fs from 'fs'

import {
  Blaze,
  applyParams
} from '@blaze-cardano/sdk'

import {
  Address,
  AssetId,
  PolicyId,
  AssetName,
  Value,
  PlutusData,
  ConstrPlutusData,
  PlutusList,
  Datum,
  Script,
  PlutusV3Script,
  HexBlob,
  fromHex
} from '@blaze-cardano/core'

import { Blockfrost } from '@blaze-cardano/query'
import { aliasWallet } from '../../blaze-wallet.mjs'

const main = async () => {
  const config = JSON.parse(fs.readFileSync("./config.json"))

  const provider = new Blockfrost({
    network: "cardano-preview", 
    projectId: config.blockfrost_project_id
  })

  const metadata = JSON.parse(fs.readFileSync("metadata.json"))
  console.log("Using script address = " + metadata.scriptAddress)

  const wallet = aliasWallet("seed", provider)
  console.log("Loaded seed wallet = " + wallet.address.toBech32())

  const policyId = PolicyId(metadata.policyId)
  const tokenName = AssetName(metadata.tokenName)
  const scriptUtxos = await provider.getUnspentOutputsWithAsset(
    Address.fromBech32(metadata.scriptAddress), 
    AssetId.fromParts(policyId, tokenName)
  )
  if (scriptUtxos.length !== 1) {
    console.error("NFT count != 1")
    process.exit()
  }
  const coreTxOut = scriptUtxos[0].toCore()[1]
  const curCount = coreTxOut.datum.fields.items[0]

  // Compute datum value = cur + 1
  const fieldList = new PlutusList()
  fieldList.add(PlutusData.newInteger(curCount + 1n))
  const incCount = new ConstrPlutusData(0n, fieldList)
  const datum = Datum.newInlineData(PlutusData.newConstrPlutusData(incCount))
  console.log(datum.toCbor())
  console.log(scriptUtxos[0].output().toCbor())

  // Create script object
  console.log("Raw cbor = " + metadata.script)
  const paramPolicyId = PlutusData.newBytes(Buffer.from(metadata.policyId, "hex"))
  const paramTokenName = PlutusData.newBytes(fromHex(metadata.tokenName))
  console.log("param1 = " + paramPolicyId.toCbor())
  console.log("param2 = " + paramTokenName.toCbor())
  const appliedCbor = applyParams(HexBlob(metadata.script), paramPolicyId, paramTokenName)
  const script = PlutusV3Script.fromCbor(HexBlob(appliedCbor))
  console.log("Script hash = " + script.hash())
  console.log("Applied CBOR = " + appliedCbor)

  // Send minted state token to script with 
  const tokenMap = new Map()
  tokenMap.set(AssetId.fromParts(PolicyId(policyId), AssetName(tokenName)), 1n)
  const value = new Value(0n, tokenMap)
  const incrementWalletHandler = await Blaze.from(provider, wallet)
  console.log(scriptUtxos[0].toCbor())
  const seedTx = await incrementWalletHandler
    .newTransaction()
    .addInput(scriptUtxos[0], PlutusData.newInteger(0n))
    .provideScript(Script.newPlutusV3Script(script))
    .lockAssets(Address.fromBech32(metadata.scriptAddress), value, datum)
    .complete()
  /*
  const signedSeedTx = await incrementWalletHandler.signTransaction(seedTx)
  const seedTxId = await incrementWalletHandler.provider.postTransactionToChain(signedSeedTx)
  console.log("Seed tx = " + seedTxId)
  await provider.awaitTransactionConfirmation(seedTxId)
  */

  process.exit()
}

main()
