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
  const provider = new BlazeProviderFrontend("ws://localhost:1338")
  await provider.init()

  // Grab a random wallet
  const mintWallet = randomWallet(provider)
  console.log("Created mint wallet = " + mintWallet.address.toBech32())

  // Fund the wallet from the devnet faucet
  const faucet = aliasWallet("faucet", provider)
  const amount = 10_000_000n
  const faucetHandler = await Blaze.from(provider, faucet)
  const fundingTx = await faucetHandler
    .newTransaction()
    .addOutput(new TransactionOutput(mintWallet.address, new Value(amount)))
    .complete()
  const signedFundingTx = await faucetHandler.signTransaction(fundingTx)
  const fundingTxId = await faucetHandler.provider.postTransactionToChain(signedFundingTx)
  console.log("Funding mint wallet with 10 ADA")
  console.log("Funding tx = " + fundingTxId)
  console.log()
  await provider.awaitTransactionConfirmation(fundingTxId)

  /* Create native minting script
  {
    "type": "all",
    "scripts": [
      { 
        "type": "sig", 
        "keyHash": <mint wallet pubkey hash>
      }
    ]
  }
  */
  
  const pubKeyScript = new ScriptPubkey()
  pubKeyScript.setKeyHash(
    Ed25519KeyHashHex(mintWallet.address.toBytes().slice(2))
  )
  const allScript = new ScriptAll()
  allScript.setNativeScripts([pubKeyScript])
  const nativeScript = NativeScript.newScriptAll(allScript)

  // Determine the asset id
  const policyId = nativeScript.hash()
  console.log("Policy ID = " + policyId)
  const tokenNameBytes = Buffer.from("counter-token", "utf8")
  const tokenName = toHex(tokenNameBytes)
  console.log("Token Name = " + tokenName)
  const paramPolicyId = PlutusData.newBytes(Buffer.from(policyId, "hex"))
  const paramTokenName = PlutusData.newBytes(fromHex(tokenName))
  //console.log("param1 = " + paramPolicyId.toCbor())
  //console.log("param2 = " + paramTokenName.toCbor())

  // Load the counter script and apply the policy ID and name as parameters
  const aikenPlutus = JSON.parse(fs.readFileSync("./aiken/plutus.json"))
  const rawCbor = aikenPlutus.validators.reduce((acc, v) => {
    if (v.title === "contract.counter.spend") {
      acc = v.compiledCode
    }
    return acc
  }, undefined)
  const appliedScript = applyParams(HexBlob(rawCbor), paramPolicyId, paramTokenName)

  // Compute the script address for these params
  const script = new PlutusV3Script(appliedScript)
  const scriptAddress = addressFromValidator(NetworkId.Testnet, script)
  console.log("Script address = " + scriptAddress.toBech32())

  // Mint one token
  const amountsToMint = new Map()
  amountsToMint.set(tokenName, BigInt(1))

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
  console.log()
  await provider.awaitTransactionConfirmation(mintingTxId)

  // Write metadata
  fs.writeFileSync("metadata.json", JSON.stringify({
    script: rawCbor,
    scriptAddress: scriptAddress.toBech32(),
    policyId: policyId,
    tokenName: tokenName
  }))

  // Compute datum value = zero
  const fieldList = new PlutusList()
  fieldList.add(PlutusData.newInteger(0n))
  const zeroCount = new ConstrPlutusData(0n, fieldList)
  const datum = PlutusData.newConstrPlutusData(zeroCount)
  console.log("Initial datum = " + datum.toCbor())

  // Send minted state token to script with datum
  const tokenMap = new Map()
  tokenMap.set(AssetId.fromParts(PolicyId(policyId), AssetName(tokenName)), 1n)
  const value = new Value(0n, tokenMap)
  const seedTx = await mintWalletHandler
    .newTransaction()
    .lockAssets(scriptAddress, value, Datum.newInlineData(datum))
    .complete()
  const signedSeedTx = await mintWalletHandler.signTransaction(seedTx)
  const seedTxId = await mintWalletHandler.provider.postTransactionToChain(signedSeedTx)
  console.log("Seed tx = " + seedTxId)
  await provider.awaitTransactionConfirmation(seedTxId)
  
  process.exit()
}

main()
