import {
  Blaze
} from '@blaze-cardano/sdk'
import { 
  TransactionOutput,
  Value
} from '@blaze-cardano/core'

import { BlazeProviderFrontend } from '../blaze-frontend.mjs'
import { aliasWallet } from '../blaze-wallet.mjs'

const name = process.argv[2]
const amount = process.argv[3]

const main = async () => {
  const provider = new BlazeProviderFrontend("ws://localhost:1338")
  await provider.init()

  const fromWallet = aliasWallet("faucet", provider)
  console.log("from address = " + fromWallet.address.toBech32())
  const toWallet = aliasWallet(name, provider)
  console.log("to address = " + toWallet.address.toBech32())

  const txOut = new TransactionOutput(toWallet.address, new Value(BigInt(amount)))

  const blaze = await Blaze.from(provider, fromWallet)
  const tx = await blaze
    .newTransaction()
    .addOutput(txOut)
    .complete()

  const signedTx = await blaze.signTransaction(tx)
  const txId = await blaze.provider.postTransactionToChain(signedTx)
  console.log("Transaction sent: " + txId)

  process.exit()
}

main()
