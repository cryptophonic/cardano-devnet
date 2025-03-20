import fs from 'fs'

import {
  Blaze,
  applyParams
} from '@blaze-cardano/sdk'
import {
  Value,
  AssetId,
  PolicyId,
  AssetName,
  NetworkId,
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
    console.log("Usage: node add-liquidity.mjs <wallet_name> <token A amount> <token B amount>")
    process.exit()
  }

  const provider = new BlazeProviderFrontend("ws://localhost:1338")
  await provider.init()

  const wallet_name = process.argv[2]
  const wallet = aliasWallet("owner", provider)

  const amount_token_a = BigInt(parseInt(process.argv[3], 10))
  const amount_token_b = BigInt(parseInt(process.argv[4], 10))
  console.log("Creating utxo with " + amount_token_a + " TokenA and " + amount_token_b + " TokenB")

  const metadata = JSON.parse(fs.readFileSync("metadata.json"))

  // Load the script and compute the script address from it
  const aikenPlutus = JSON.parse(fs.readFileSync("./aiken/plutus.json"))
  const rawCbor = aikenPlutus.validators.reduce((acc, v) => {
    if (v.title === "contract.dex.spend") {
      acc = v.compiledCode
    }
    return acc
  }, undefined)
  const paramPolicyId = PlutusData.newBytes(Buffer.from(metadata.policyId, "hex"))
  const paramTokenAName = PlutusData.newBytes(fromHex(metadata.tokenAName))
  const paramTokenBName = PlutusData.newBytes(fromHex(metadata.tokenAName))
  const appliedScript = applyParams(HexBlob(rawCbor), paramPolicyId, paramTokenAName, paramPolicyId,
    paramTokenBName)
  
  // Compute the script address for these params
  const script = new PlutusV3Script(appliedScript)
  const scriptAddress = addressFromValidator(NetworkId.Testnet, script)
  console.log("Script address = " + scriptAddress.toBech32())

  fs.writeFileSync("metadata.json", JSON.stringify({
    policyId: metadata.policyId,
    tokenAName: metadata.tokenAName,
    tokenBName: metadata.tokenBName,
    script: rawCbor,
    scriptAddress: scriptAddress.toBech32()
  }, null, 2))

  const fieldList = new PlutusList()
  const zeroCount = new ConstrPlutusData(0n, fieldList)
  const datum = PlutusData.newConstrPlutusData(zeroCount)

  // Add liquidity transaction
  const tokenMap = new Map()
  tokenMap.set(AssetId.fromParts(PolicyId(metadata.policyId), AssetName(metadata.tokenAName)), amount_token_a)
  tokenMap.set(AssetId.fromParts(PolicyId(metadata.policyId), AssetName(metadata.tokenBName)), amount_token_b)
  const value = new Value(0n, tokenMap)
  const walletHandler = await Blaze.from(provider, wallet)
  const addTx = await walletHandler
    .newTransaction()
    .lockAssets(scriptAddress, value, Datum.newInlineData(datum))
    .complete()
  const signedAddTx = await walletHandler.signTransaction(addTx)
  const addTxId = await walletHandler.provider.postTransactionToChain(signedAddTx)
  console.log("tx = " + addTxId)

  process.exit()
}

main()
