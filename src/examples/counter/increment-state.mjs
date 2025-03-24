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

import { BlazeProviderFrontend } from '../../blaze-frontend.mjs'
import { aliasWallet } from '../../blaze-wallet.mjs'

const main = async () => {
  if (process.argv.length !== 3) {
    console.error("Usage: node increment-state.mjs <wallet_name>")
    process.exit()
  }

  const provider = new BlazeProviderFrontend("ws://localhost:1338")
  await provider.init()

  const metadata = JSON.parse(fs.readFileSync("metadata.json"))
  console.log("Script address = " + metadata.scriptAddress)

  const alias = process.argv[2]
  const wallet = aliasWallet(alias, provider)
  console.log("Using " + alias + " wallet = " + wallet.address.toBech32())

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
  console.log("Current count is " + curCount)

  // Compute datum value = cur + 1
  const newCount = curCount + 1n
  console.log("New count is " + newCount)
  const fieldList = new PlutusList()
  fieldList.add(PlutusData.newInteger(newCount))
  const incCount = new ConstrPlutusData(0n, fieldList)
  const datum = PlutusData.newConstrPlutusData(incCount)
  console.log("New datum = " + datum.toCbor())

  // Create script object
  const paramPolicyId = PlutusData.newBytes(Buffer.from(metadata.policyId, "hex"))
  const paramTokenName = PlutusData.newBytes(fromHex(metadata.tokenName))
  const appliedScript = applyParams(HexBlob(metadata.script), paramPolicyId, paramTokenName)
  const script = new PlutusV3Script(HexBlob(appliedScript))

  // Send minted state token to script with 
  const tokenMap = new Map()
  tokenMap.set(AssetId.fromParts(PolicyId(policyId), AssetName(tokenName)), 1n)
  const value = new Value(0n, tokenMap)
  const incrementWalletHandler = await Blaze.from(provider, wallet)
  const seedTx = await incrementWalletHandler
    .newTransaction()
    .addInput(scriptUtxos[0], PlutusData.newInteger(0n))
    .provideScript(Script.newPlutusV3Script(script))
    .lockAssets(Address.fromBech32(metadata.scriptAddress), value, Datum.newInlineData(datum))
    .complete()
  const signedSeedTx = await incrementWalletHandler.signTransaction(seedTx)
  const seedTxId = await incrementWalletHandler.provider.postTransactionToChain(signedSeedTx)
  console.log("Seed tx = " + seedTxId)
  await provider.awaitTransactionConfirmation(seedTxId)

  process.exit()
}

main()
