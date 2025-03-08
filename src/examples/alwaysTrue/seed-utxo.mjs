import fs from 'fs'

import {
  Blaze,
  applyParams
} from '@blaze-cardano/sdk'
import {
  Address,
  TransactionOutput,
  Value,
  AssetId,
  PolicyId,
  AssetName,
  NetworkId,
  ScriptPubkey,
  Ed25519KeyHashHex,
  ScriptAll,
  NativeScript,
  Script,
  toHex,
  HexBlob,
  PlutusV2Script,
  CredentialType,
  PlutusData,
  ConstrPlutusData,
  PlutusList,
  Datum,
  addressFromValidator
} from '@blaze-cardano/core'

import { BlazeProviderFrontend } from '../../blaze-frontend.mjs'
import { randomWallet, aliasWallet } from '../../blaze-wallet.mjs'

const main = async () => {
  const provider = new BlazeProviderFrontend("ws://localhost:1338")
  await provider.init()

  // Grab a random wallet
  const seedWallet = randomWallet(provider)
  console.log("Created seed wallet = " + seedWallet.address.toBech32())

  // Fund the wallet from the devnet faucet
  const faucet = aliasWallet("faucet", provider)
  const amount = 10_000_000n
  const faucetHandler = await Blaze.from(provider, faucet)
  const fundingTx = await faucetHandler
    .newTransaction()
    .addOutput(new TransactionOutput(seedWallet.address, new Value(amount)))
    .complete()
  const signedFundingTx = await faucetHandler.signTransaction(fundingTx)
  const fundingTxId = await faucetHandler.provider.postTransactionToChain(signedFundingTx)
  console.log("Funding tx = " + fundingTxId)
  await provider.awaitTransactionConfirmation(fundingTxId)

  const alwaysTrueV2 = Script.newPlutusV2Script(
    new PlutusV2Script(HexBlob("510100003222253330044a229309b2b2b9a1"))
  )

  const scriptAddressV2 = addressFromValidator(NetworkId.Testnet, alwaysTrueV2)
  console.log("Script address = " + scriptAddressV2.toBech32())

  // Write metadata
  fs.writeFileSync("metadata.json", JSON.stringify({
    script: alwaysTrueV2.toCbor(),
    scriptAddress: scriptAddressV2.toBech32()
  }))

  // Data.to(new Constr(0, [[]]))
  const insideList = new PlutusList()
  const fieldList = new PlutusList()
  fieldList.add(PlutusData.newList(insideList))
  const zeroCount = new ConstrPlutusData(0n, fieldList)
  const datum = Datum.newInlineData(PlutusData.newConstrPlutusData(zeroCount))
  // Compute datum value = zero
  //const datum = Datum.newInlineData(PlutusData.newInteger(0n))
  //console.log("datum cbor = " + datum.toCbor())

  // Send lovelace to script with datum
  const seedWalletHandler = await Blaze.from(provider, seedWallet)
  const seedTx = await seedWalletHandler
    .newTransaction()
    .lockLovelace(scriptAddressV2, 5_000_000n, datum)
    .complete()
  const signedSeedTx = await seedWalletHandler.signTransaction(seedTx)
  const seedTxId = await seedWalletHandler.provider.postTransactionToChain(signedSeedTx)
  console.log("Seed tx = " + seedTxId)
  await provider.awaitTransactionConfirmation(seedTxId)
  
  process.exit()
}

main()
