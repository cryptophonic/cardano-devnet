import fs from 'fs'

import {
  Blaze,
} from '@blaze-cardano/sdk'
import {
  TransactionOutput,
  Value,
  NetworkId,
  Script,
  HexBlob,
  PlutusV3Script,
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
  console.log("Funding wallet with 10 ADA")
  console.log("Funding tx = " + fundingTxId)
  await provider.awaitTransactionConfirmation(fundingTxId)

  // Load the always_succeeds script 
  const aikenPlutus = JSON.parse(fs.readFileSync("./aiken/plutus.json"))
  const cbor = aikenPlutus.validators.reduce((acc, v) => {
    if (v.title === "contract.always_succeeds.spend") {
      acc = v.compiledCode
    }
    return acc
  }, undefined)
  const alwaysTrueV3 = Script.newPlutusV3Script(
    new PlutusV3Script(HexBlob(cbor))
  )

  const scriptAddressV3 = addressFromValidator(NetworkId.Testnet, alwaysTrueV3)
  console.log("Script address = " + scriptAddressV3.toBech32())

  // Write metadata
  fs.writeFileSync("metadata.json", JSON.stringify({
    script: cbor,
    scriptAddress: scriptAddressV3.toBech32()
  }))

  // Null datum: Constr(0, [[]])
  //const innerList = new PlutusList()
  const innerData = PlutusData.newInteger(0n)
  const fieldList = new PlutusList()
  fieldList.add(PlutusData.newInteger(innerData))
  const zeroCount = new ConstrPlutusData(0n, fieldList)
  const datum = Datum.newInlineData(PlutusData.newConstrPlutusData(zeroCount))

  // Send lovelace to script with datum
  const seedWalletHandler = await Blaze.from(provider, seedWallet)
  const seedTx = await seedWalletHandler
    .newTransaction()
    .lockLovelace(scriptAddressV3, 5_000_000n, datum)
    .complete()
  const signedSeedTx = await seedWalletHandler.signTransaction(seedTx)
  const seedTxId = await seedWalletHandler.provider.postTransactionToChain(signedSeedTx)
  console.log("Seeding script address with 5 locked ADA")
  console.log("Seed tx = " + seedTxId)
  await provider.awaitTransactionConfirmation(seedTxId)
  
  process.exit()
}

main()
