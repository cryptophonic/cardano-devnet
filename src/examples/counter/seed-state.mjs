import fs from 'fs'

import {
  Blaze,
  applyParams
} from '@blaze-cardano/sdk'
import {
  Address,
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
  PlutusV2Script,
  CredentialType,
  PlutusData,
  ConstrPlutusData,
  PlutusList,
  Datum
} from '@blaze-cardano/core'
import {
  Cardano
} from '@cardano-sdk/core'

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
  const fundingTxId = await faucetHandler.provider.postTransactionToChain(signedFundingTx.toCbor())
  console.log("Funding tx = " + fundingTxId)
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

  // Load the counter script and apply the policy ID and name as parameters
  const aikenPlutus = JSON.parse(fs.readFileSync("./aiken/plutus.json"))
  const rawCbor = aikenPlutus.validators.reduce((acc, v) => {
    if (v.title === "counter.increment.spend") {
      acc = v.compiledCode
    }
    return acc
  }, undefined)
  const appliedCbor = applyParams(HexBlob(rawCbor), 
    PlutusData.newBytes(Buffer.from(policyId, "hex")),
    PlutusData.newBytes(tokenNameBytes)
  )

  // Compute the script address for these params
  const script = new PlutusV2Script(appliedCbor)
  console.log("script hash = " + script.hash())
  const scriptAddress = Cardano.EnterpriseAddress.fromCredentials(NetworkId.Testnet, {
    hash: script.hash(),
    type: CredentialType.ScriptHash
  }).toAddress()
    .toBech32()
  console.log("Script address = " + scriptAddress)

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
  const mintingTxId = await mintWalletHandler.provider.postTransactionToChain(signedMintingTx.toCbor())
  console.log("Minting tx = " + mintingTxId)
  await provider.awaitTransactionConfirmation(mintingTxId)

  // Write metadata
  fs.writeFileSync("metadata.json", JSON.stringify({
    script: appliedCbor,
    scriptAddress: scriptAddress,
    policyId: policyId,
    tokenName: tokenName
  }))

  // Compute datum value = zero
  const fieldList = new PlutusList()
  fieldList.add(PlutusData.newInteger(0n))
  const zeroCount = new ConstrPlutusData(0n, fieldList)
  const datum = Datum.newInlineData(PlutusData.newConstrPlutusData(zeroCount))

  // Send minted state token to script with 
  const tokenMap = new Map()
  tokenMap.set(AssetId.fromParts(PolicyId(policyId), AssetName(tokenName)), 1n)
  const value = new Value(0n, tokenMap)
  const seedTx = await mintWalletHandler
    .newTransaction()
    .lockAssets(Address.fromBech32(scriptAddress), value, datum)
    .complete()
  const signedSeedTx = await mintWalletHandler.signTransaction(seedTx)
  const seedTxId = await mintWalletHandler.provider.postTransactionToChain(signedSeedTx.toCbor())
  console.log("Seed tx = " + seedTxId)
  await provider.awaitTransactionConfirmation(seedTxId)
  
  process.exit()
}

main()
