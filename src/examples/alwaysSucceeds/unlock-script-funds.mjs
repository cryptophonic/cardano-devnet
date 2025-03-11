import fs from 'fs'

import {
  Blaze
} from '@blaze-cardano/sdk'

import {
  TransactionUnspentOutput,
  PlutusData,
  Script,
  PlutusV3Script,
  HexBlob,
  Address
} from '@blaze-cardano/core'

import { BlazeProviderFrontend } from '../../blaze-frontend.mjs'
import { aliasWallet } from '../../blaze-wallet.mjs'

const main = async () => {
  if (process.argv.length !== 3) {
    console.error("Usage: node unlockScriptFunds.mjs <wallet_name>")
    process.exit()
  }

  const provider = new BlazeProviderFrontend("ws://localhost:1338")
  await provider.init()

  const alias = process.argv[2]
  const wallet = aliasWallet(alias, provider)
  console.log("Loaded " + alias + " wallet = " + wallet.address.toBech32())

  // Load metadata
  const metadata = JSON.parse(fs.readFileSync("metadata.json"))
  console.log("Script address = " + metadata.scriptAddress)
  const alwaysTrueV3 = Script.newPlutusV3Script(
    new PlutusV3Script(HexBlob(metadata.script))
  )
  const scriptAddressV3 = Address.fromBech32(metadata.scriptAddress)

  const scriptUtxos = await provider.getUnspentOutputs(scriptAddressV3)
  if (scriptUtxos.length === 0) {
    throw Error("No utxos locked at script address")
  }
  const input = new TransactionUnspentOutput()

  const precomplete = async (builder) => {
    console.log(JSON.stringify(builder.params, null, 2))
    for (let i=0; i<3; i++) {
      const model = builder.params.costModels.get(i)
      const str = model.reduce((acc, el) => {
        return acc + " " + el
      }, "[")
      console.log(i + " (" + model.length + " elements): " + str + "]")
    }    
  }

  const walletHandler = await Blaze.from(provider, wallet)
  const tx = await walletHandler
    .newTransaction()
    //.addPreCompleteHook(precomplete)
    .addInput(scriptUtxos[0], PlutusData.newInteger(0n))
    .provideScript(alwaysTrueV3)
    .complete()
  //console.log(tx.toCbor())
  const signedTx = await walletHandler.signTransaction(tx)
  const txId = await walletHandler.provider.postTransactionToChain(signedTx)
  console.log("tx = " + txId)

  process.exit()
}

main()
