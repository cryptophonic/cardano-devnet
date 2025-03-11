import fs from 'fs'

import {
  Blaze
} from '@blaze-cardano/sdk'

import {
  NetworkId,
  TransactionInput,
  TransactionUnspentOutput,
  PlutusData,
  Script,
  PlutusV2Script,
  HexBlob,
  addressFromValidator
} from '@blaze-cardano/core'

import { Blockfrost } from '@blaze-cardano/query'
import { aliasWallet } from '../../blaze-wallet.mjs'

const main = async () => {
  if (process.argv.length !== 3) {
    console.error("Usage: node unlockScriptFunds.mjs <txid>")
    process.exit()
  }

  const config = JSON.parse(fs.readFileSync("./config.json"))

  const provider = new Blockfrost({
    network: "cardano-preview", 
    projectId: config.blockfrost_project_id
  })

  const wallet = aliasWallet("seed", provider)
  console.log("Loaded seed wallet = " + wallet.address.toBech32())

  const alwaysTrueV2 = Script.newPlutusV2Script(
    new PlutusV2Script(HexBlob("510100003222253330044a229309b2b2b9a1"))
  )

  const scriptAddressV2 = addressFromValidator(NetworkId.Testnet, alwaysTrueV2)
  console.log("Script address = " + scriptAddressV2.toBech32())

  const scriptUtxos = await provider.getUnspentOutputs(scriptAddressV2)
  if (scriptUtxos.length === 0) {
    throw Error("No utxos locked at script address")
  }

  const [ id, ref ] = process.argv[2].split('#')
  const input = new TransactionInput(id, BigInt(ref))
  const [ utxo ] = await provider.resolveUnspentOutputs([ input ])

  const precomplete = async (builder) => {
    console.log("here")
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
    .addPreCompleteHook(precomplete)
    .addInput(utxo, PlutusData.newInteger(0n))
    .provideScript(alwaysTrueV2)
    .complete()
  console.log(tx.toCbor())
  //const signedTx = await walletHandler.signTransaction(tx)
  //const txId = await walletHandler.provider.postTransactionToChain(signedTx)
  //console.log("tx = " + txId)

  process.exit()
}

main()
