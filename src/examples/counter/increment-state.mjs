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
  Datum
} from '@blaze-cardano/core'

import { BlazeProviderFrontend } from '../../blaze-frontend.mjs'
import { aliasWallet } from '../../blaze-wallet.mjs'

const main = async () => {
  if (process.argv.length !== 3) {
    console.log("Usage: node increment-state.mjs <wallet_name>")
    process.exit()
  }

  const metadata = JSON.parse(fs.readFileSync("metadata.json"))
  console.log("Using script address = " + metadata.scriptAddress)

  const provider = new BlazeProviderFrontend("ws://localhost:1338")
  await provider.init()

  const alias = process.argv[2]
  const wallet = aliasWallet(alias)
  console.log("Loaded " + alias + " wallet = " + wallet.address.toBech32())

  const policyId = PolicyId(metadata.policyId)
  const tokenName = AssetName(metadata.tokenName)
  const utxos = await provider.getUnspentOutputsWithAsset(
    Address.fromBech32(metadata.scriptAddress), 
    AssetId.fromParts(policyId, tokenName)
  )
  if (utxos.length !== 1) {
    console.error("NFT count != 1")
    process.exit()
  }
  const coreTxOut = utxos[0].toCore()[1]
  const curCount = coreTxOut.datum.fields.items[0]

  // Compute datum value = zero
  const fieldList = new PlutusList()
  fieldList.add(PlutusData.newInteger(curCount + 1n))
  const zeroCount = new ConstrPlutusData(0n, fieldList)
  const datum = Datum.newInlineData(PlutusData.newConstrPlutusData(zeroCount))

  // Send minted state token to script with 
  const tokenMap = new Map()
  tokenMap.set(AssetId.fromParts(policyId, tokenName), 1n)
  const value = new Value(0n, tokenMap)
  const incrementWalletHandler = await Blaze.from(provider, wallet)
  const seedTx = await incrementWalletHandler
    .newTransaction()
    .addOutput(utxos[0])
    .lockAssets(Address.fromBech32(scriptAddress), value, datum)
    .complete()
  const signedSeedTx = await incrementWalletHandler.signTransaction(seedTx)
  const seedTxId = await incrementWalletHandler.provider.postTransactionToChain(signedSeedTx.toCbor())
  console.log("Seed tx = " + seedTxId)
  await provider.awaitTransactionConfirmation(seedTxId)

  process.exit()
}

main()
