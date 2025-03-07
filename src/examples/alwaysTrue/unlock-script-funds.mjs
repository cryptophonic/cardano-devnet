import {
  Blaze
} from '@blaze-cardano/sdk'

import {
  NetworkId,
  TransactionUnspentOutput,
  PlutusData,
  Script,
  PlutusV2Script,
  HexBlob,
  addressFromValidator
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

  const alwaysTrueV2 = Script.newPlutusV2Script(
    new PlutusV2Script(HexBlob("510100003222253330044a229309b2b2b9a1"))
  )

  const scriptAddressV2 = addressFromValidator(NetworkId.Testnet, alwaysTrueV2)
  console.log("Script address = " + scriptAddressV2.toBech32())

  const scriptUtxos = await provider.getUnspentOutputs(scriptAddressV2)
  if (scriptUtxos.length === 0) {
    throw Error("No utxos locked at script address")
  }
  const input = new TransactionUnspentOutput()

  const walletHandler = await Blaze.from(provider, wallet)
  const tx = await walletHandler
    .newTransaction()
    .addInput(scriptUtxos[0], PlutusData.newInteger(0n))
    .provideScript(alwaysTrueV2)
    .complete()
  const signedTx = await walletHandler.signTransaction(tx)
  const txId = await walletHandler.provider.postTransactionToChain(signedTx)
  console.log("tx = " + txId)

  process.exit()
}

main()
