import fs from 'fs'

import {
  Blaze,
  applyParams
} from '@blaze-cardano/sdk'
import {
  Value,
  Address,
  AssetId,
  PolicyId,
  AssetName,
  NetworkId,
  Script,
  fromHex,
  HexBlob,
  PlutusV3Script,
  PlutusData,
  ConstrPlutusData,
  PlutusList,
  Datum,
  addressFromValidator,
  TransactionInput
} from '@blaze-cardano/core'

import { BlazeProviderFrontend } from '../../blaze-frontend.mjs'
import { aliasWallet } from '../../blaze-wallet.mjs'

const main = async () => {
  if (process.argv.length !== 6) {
    console.log("Usage: node swap.mjs <wallet_name> [AtoB|BtoA] <trade in amount> <utxo>")
    process.exit()
  }

  const provider = new BlazeProviderFrontend("ws://localhost:1338")
  await provider.init()

  const wallet_name = process.argv[2]
  const wallet = aliasWallet(wallet_name, provider)
  console.log("Using wallet: " + wallet_name)

  let dir = 0
  if (process.argv[3] === "AtoB") dir = 1
  if (process.argv[3] === "BtoA") dir = -1
  const amount = BigInt(parseInt(process.argv[4], 10))

  const metadata = JSON.parse(fs.readFileSync("metadata.json"))

  const paramPolicyId = PlutusData.newBytes(Buffer.from(metadata.policyId, "hex"))
  const paramTokenAName = PlutusData.newBytes(fromHex(metadata.tokenAName))
  const paramTokenBName = PlutusData.newBytes(fromHex(metadata.tokenBName))
  const appliedScript = applyParams(HexBlob(metadata.script), paramPolicyId, paramTokenAName, paramPolicyId,
    paramTokenBName)
  const script = new PlutusV3Script(appliedScript)
  const scriptAddress = addressFromValidator(NetworkId.Testnet, script)
  console.log("Script address=" + scriptAddress.toBech32())

  // Get the current token amounts in utxo
  const outRefParts = process.argv[5].split("#")
  const txin = new TransactionInput(outRefParts[0], BigInt(outRefParts[1]))
  const [utxo] = await provider.resolveUnspentOutputs([txin])
  const inTokenMap = utxo.output().amount().multiasset()
  const inA = inTokenMap.get(AssetId.fromParts(PolicyId(metadata.policyId), AssetName(metadata.tokenAName)))
  const inB = inTokenMap.get(AssetId.fromParts(PolicyId(metadata.policyId), AssetName(metadata.tokenBName)))

  let final_token_a = 0n
  let final_token_b = 0n
  let amount_token_a = 0n
  let amount_token_b = 0n
  if (dir > 0) {
    final_token_a = inA + amount
    final_token_b = inA * inB / final_token_a + 1n
    amount_token_a = amount
    amount_token_b = inB - final_token_b
    console.log("Swapping " + amount_token_a + " TokenA for " + amount_token_b + " TokenB")
  } else {
    final_token_b = inB + amount
    final_token_a = inA * inB / final_token_b + 1n
    amount_token_b = amount
    amount_token_a = inA - final_token_a
    console.log("Swapping " + amount_token_b + " TokenB for " + amount_token_a + " TokenA")
  }

  console.log("Initial token amounts: " + inA + " A, " + inB + " B")
  console.log("New token amounts: " + final_token_a + " A, " + final_token_b + " B")

  const fieldList = new PlutusList()
  fieldList.add(PlutusData.newInteger(0n))
  const zeroCount = new ConstrPlutusData(0n, fieldList)
  const datum = PlutusData.newConstrPlutusData(zeroCount)

  const tokenMap = new Map()
  tokenMap.set(AssetId.fromParts(PolicyId(metadata.policyId), AssetName(metadata.tokenAName)), final_token_a)
  tokenMap.set(AssetId.fromParts(PolicyId(metadata.policyId), AssetName(metadata.tokenBName)), final_token_b)
  const value = new Value(0n, tokenMap)
  const walletHandler = await Blaze.from(provider, wallet)
  const swapTx = await walletHandler
    .newTransaction()
    .addInput(utxo, PlutusData.newInteger(0n))
    .provideScript(Script.newPlutusV3Script(script))
    .lockAssets(Address.fromBech32(metadata.scriptAddress), value, Datum.newInlineData(datum))
    .complete()
  const signedSwapTx = await walletHandler.signTransaction(swapTx)
  const swapTxId = await walletHandler.provider.postTransactionToChain(signedSwapTx)
  console.log("Swap tx = " + swapTxId)
  await provider.awaitTransactionConfirmation(swapTxId)

  process.exit()
}

main()
