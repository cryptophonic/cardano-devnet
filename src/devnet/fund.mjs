import { Blaze } from '@blaze-cardano/sdk'
import {
  Value,
  TransactionOutput
} from '@blaze-cardano/core'

import { BlazeProviderFrontend } from '../blaze-frontend.mjs'
import { randomWallet, aliasWallet } from '../blaze-wallet.mjs'

const wallet_name = process.argv[2]
const amount = BigInt(Math.floor(process.argv[3] * 1000000.0))
console.log("Funding wallet: " + wallet_name + " " + amount + " lovelace")

const main = async () => {
  const provider = new BlazeProviderFrontend("ws://localhost:1338")
  await provider.init()

  const wallet = aliasWallet(wallet_name, provider)
  const faucet = aliasWallet("faucet", provider)
  const faucetHandler = await Blaze.from(provider, faucet)
  const fundingTx = await faucetHandler
    .newTransaction()
    .addOutput(new TransactionOutput(wallet.address, new Value(amount)))
    .complete()
  const signedFundingTx = await faucetHandler.signTransaction(fundingTx)
  const fundingTxId = await faucetHandler.provider.postTransactionToChain(signedFundingTx)
  console.log("Funding tx = " + fundingTxId)
  await provider.awaitTransactionConfirmation(fundingTxId)

  process.exit()
}

main()
