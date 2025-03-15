import fs from 'fs'

import {
  Blaze,
} from '@blaze-cardano/sdk'
import {
  NetworkId,
  Script,
  HexBlob,
  PlutusV2Script,
  PlutusData,
  ConstrPlutusData,
  PlutusList,
  Datum,
  addressFromValidator
} from '@blaze-cardano/core'

import { Blockfrost } from '@blaze-cardano/query'
import { aliasWallet } from '../../blaze-wallet.mjs'

const main = async () => {
  const config = JSON.parse(fs.readFileSync("./config.json"))

  const provider = new Blockfrost({
    network: "cardano-preview", 
    projectId: config.blockfrost_project_id
  })

  const seedWallet = aliasWallet("seed", provider)
  console.log("Loaded seed wallet = " + seedWallet.address.toBech32())

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

  // Null datum: Data.to(new Constr(0, [[]]))
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
