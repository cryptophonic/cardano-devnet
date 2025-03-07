import fs from 'fs'

import {
  Blaze
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
  PlutusV2Script,
  HexBlob
} from '@blaze-cardano/core'

import { BlazeProviderFrontend } from '../../blaze-frontend.mjs'
import { aliasWallet } from '../../blaze-wallet.mjs'

const main = async () => {
  if (process.argv.length !== 3) {
    console.error("Usage: node increment-state.mjs <wallet_name>")
    process.exit()
  }

  const metadata = JSON.parse(fs.readFileSync("metadata.json"))
  console.log("Using script address = " + metadata.scriptAddress)

  const provider = new BlazeProviderFrontend("ws://localhost:1338")
  await provider.init()

  const alias = process.argv[2]
  const wallet = aliasWallet(alias, provider)
  console.log("Loaded " + alias + " wallet = " + wallet.address.toBech32())

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
  console.log("applied cbor = " + metadata.script)
  const script = PlutusV2Script.fromCbor(HexBlob(metadata.script))
  console.log("script hash = " + script.hash())

  // Send minted state token to script with 
  const tokenMap = new Map()
  tokenMap.set(AssetId.fromParts(PolicyId(policyId), AssetName(tokenName)), 1n)
  const value = new Value(0n, tokenMap)
  const incrementWalletHandler = await Blaze.from(provider, wallet)
  console.log(scriptUtxos[0].toCbor())
  const seedTx = await incrementWalletHandler
    .newTransaction()
    .addInput(scriptUtxos[0], PlutusData.newInteger(0n))
    .provideScript(Script.newPlutusV2Script(script))
    .lockAssets(Address.fromBech32(metadata.scriptAddress), value, datum)
    .complete()
  const signedSeedTx = await incrementWalletHandler.signTransaction(seedTx)
  const seedTxId = await incrementWalletHandler.provider.postTransactionToChain(signedSeedTx)
  console.log("Seed tx = " + seedTxId)
  await provider.awaitTransactionConfirmation(seedTxId)

  process.exit()
}

main()
