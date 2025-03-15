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
  HexBlob,
  PlutusV3Script,
  PlutusData,
  ConstrPlutusData,
  PlutusList,
  Datum,
  addressFromValidator
} from '@blaze-cardano/core'

import { Blockfrost } from '@blaze-cardano/query'
import { randomWallet, aliasWallet } from '../../blaze-wallet.mjs'

const keypress = async () => {
  process.stdin.setRawMode(true)
  return new Promise(resolve => process.stdin.once('data', () => {
    process.stdin.setRawMode(false)
    resolve()
  }))
}

const main = async () => {
  const config = JSON.parse(fs.readFileSync("./config.json"))

  const provider = new Blockfrost({
    network: "cardano-preview", 
    projectId: config.blockfrost_project_id
  })

  const mintWallet = randomWallet(provider)
  console.log("Created mint wallet = " + mintWallet.address.toBech32())

  // Fund the wallet with 3 ADA from the seed wallet
  const faucet = aliasWallet("seed", provider)
  const amount = 3_000_000n
  const faucetHandler = await Blaze.from(provider, faucet)
  const fundingTx = await faucetHandler
    .newTransaction()
    .addOutput(new TransactionOutput(mintWallet.address, new Value(amount)))
    .complete()
  const signedFundingTx = await faucetHandler.signTransaction(fundingTx)
  const fundingTxId = await faucetHandler.provider.postTransactionToChain(signedFundingTx)
  console.log("Funding mint wallet with 3 ADA")
  console.log("Funding tx = " + fundingTxId)
  console.log("Press any key whan confirmed")
  await keypress()

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

  // Load the counter script and apply the policy ID and name as parameters
  const aikenPlutus = JSON.parse(fs.readFileSync("./aiken/plutus.json"))
  const rawCbor = aikenPlutus.validators.reduce((acc, v) => {
    if (v.title === "contract.counter.spend") {
      acc = v.compiledCode
    }
    return acc
  }, undefined)
  const appliedCbor = applyParams(HexBlob(rawCbor), 
    PlutusData.newBytes(Buffer.from(policyId, "hex")),
    PlutusData.newBytes(tokenNameBytes)
  )

  // Compute the script address for these params
  console.log("applied cbor = " + appliedCbor)
  //const script = new PlutusV3Script(appliedCbor)
  const script = PlutusV3Script.fromCbor(appliedCbor)
  console.log("script hash = " + script.hash())
  const script2 = Script.newPlutusV3Script(script)
  console.log("script2 hash = " + script.hash())
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
  console.log("Press any key whan confirmed")
  await keypress()

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
  const datum = Datum.newInlineData(PlutusData.newConstrPlutusData(zeroCount))
  console.log(datum.toCbor())

  // Send minted state token to script with datum
  const tokenMap = new Map()
  tokenMap.set(AssetId.fromParts(PolicyId(policyId), AssetName(tokenName)), 1n)
  const value = new Value(0n, tokenMap)
  const seedTx = await mintWalletHandler
    .newTransaction()
    .lockAssets(scriptAddress, value, datum)
    .complete()
  const signedSeedTx = await mintWalletHandler.signTransaction(seedTx)
  const seedTxId = await mintWalletHandler.provider.postTransactionToChain(signedSeedTx)
  console.log("Seed tx = " + seedTxId)
  
  process.exit()
}

main()
