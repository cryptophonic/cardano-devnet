import fs from 'fs'

import {
  Blaze,
  applyParams
} from '@blaze-cardano/sdk'
import {
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
  fromHex,
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
  if (process.argv.length !== 5) {
    console.log("Usage: node mint-trading-tokens.mjs <wallet_name> <token A amount> <token B amount>")
    process.exit()
  }

  const wallet_name = process.argv[2]
  console.log("Using wallet: " + wallet_name)

  const amount_token_a = parseInt(process.argv[3], 10)
  const amount_token_b = parseInt(process.argv[4], 10)
  console.log("Minting " + amount_token_a + " TokenA and " + amount_token_b + " TokenB")

  const provider = new BlazeProviderFrontend("ws://localhost:1338")
  await provider.init()

  /* Create native minting script with no restrictions
  {
    "type": "all",
    "scripts": []
  }
  */

  const allScript = new ScriptAll()
  allScript.setNativeScripts([])
  const nativeScript = NativeScript.newScriptAll(allScript)

  // Mint an NFT "state token"
  const mintWallet = aliasWallet(wallet_name, provider)
  const policyId = nativeScript.hash()
  console.log("Policy ID = " + policyId)
  const tokenAName = toHex(Buffer.from("TokenA", "utf8"))
  const tokenBName = toHex(Buffer.from("TokenB", "utf8"))

  // Minting amounts
  const amountsToMint = new Map()
  amountsToMint.set(tokenAName, BigInt(amount_token_a))
  amountsToMint.set(tokenBName, BigInt(amount_token_b))

  // Submit minting transaction

  const mintWalletHandler = await Blaze.from(provider, mintWallet)
  const mintingTx = await mintWalletHandler
    .newTransaction()
    .addMint(policyId, amountsToMint)
    .provideScript(Script.newNativeScript(nativeScript))
    .complete()
  const signedMintingTx = await mintWalletHandler.signTransaction(mintingTx)
  const mintingTxId = await mintWalletHandler.provider.postTransactionToChain(signedMintingTx)
  console.log("Minting tx = " + mintingTxId)

  process.exit()
}

main()
