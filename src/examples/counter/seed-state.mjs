/*
import fs from 'fs'

import { Data, Lucid, fromText, applyParamsToScript } from 'lucid-cardano'
import { LucidProviderFrontend } from '../../lucid-frontend.mjs'
import { loadPrivateKey } from '../../key-utils.mjs'

// This schema must match the state type for the validator script
// See aiken/validators/counter.ak for the state type
const CounterSchema = Data.Object({
  counter: Data.Integer()
})

// Initial state object with counter set to 0
const zeroState = { counter: 0n }

const main = async () => {
  const provider = new LucidProviderFrontend("ws://localhost:1338")
  await provider.init()
  const lucid = await Lucid.new(provider, "Custom")

  lucid.selectWalletFromPrivateKey(loadPrivateKey("owner"))

  // Get the state token policyId
  const script = JSON.parse(fs.readFileSync("state-token.script"))
  const mintingPolicy = lucid.utils.nativeScriptFromJson(script)
  const policyId = lucid.utils.mintingPolicyToId(mintingPolicy)
  const unit = policyId + fromText("counter-token")

  // Get the script address
  const counterScript = JSON.parse(fs.readFileSync("aiken/plutus.json"))
  const validator = {
    type: "PlutusV2",
    script: applyParamsToScript(counterScript.validators[0].compiledCode, [
      policyId, fromText("counter-token")
    ])
  }
  const scriptAddr = lucid.utils.validatorToAddress(validator)
  console.log("Script address=" + scriptAddr)

  // Serialize the counter = 0 state to CBOR
  const datum = Data.to(zeroState, CounterSchema)
  console.log("Datum=" + datum)

  try {

    // Create a utxo with counter = 0 and the state NFT token attached
    const tx = await lucid.newTx()
      .payToContract(scriptAddr, { inline: datum }, { [unit]: 1n })
      .complete()

    const signedTx = await tx.sign().complete()
    const txHash = await signedTx.submit()

  } catch (err) {
    console.log("Caught error: " + err)
  }

  process.exit()
}

main()
*/

import fs from 'fs'

import {
  Blaze,
  applyParams
} from '@blaze-cardano/sdk'
import {
  TransactionOutput,
  Value,
  AssetId,
  ScriptPubkey,
  Ed25519KeyHashHex,
  ScriptAll,
  NativeScript,
  Script,
  toHex,
  HexBlob,
  PlutusData,
  PlutusV2Script,
  Address
} from '@blaze-cardano/core'
import { applyParamsToScript } from '@blaze-cardano/uplc'

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
  console.log("Funding tx hash = " + fundingTxId)
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
  console.log("policy ID = " + policyId)
  const tokenNameBytes = Buffer.from("counter-token", "utf8")
  const tokenName = toHex(tokenNameBytes)
  //const assetId = AssetId.fromParts(policyId, tokenName)

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
  console.log("minting transaction = " + mintingTxId)
  await provider.awaitTransactionConfirmation(mintingTxId)

  // Load the counter script and apply the policy ID and name as parameters
  const aikenPlutus = JSON.parse(fs.readFileSync("./aiken/plutus.json"))
  const cbor = aikenPlutus.validators.reduce((acc, v) => {
    if (v.title === "counter.increment.spend") {
      acc = v.compiledCode
    }
    return acc
  }, undefined)

  const appliedCbor = applyParams(HexBlob(cbor), 
    PlutusData.newBytes(Buffer.from(policyId, "hex")),
    PlutusData.newBytes(tokenNameBytes)
  )

  const script = new PlutusV2Script(appliedCbor)
  const hash = script.hash()
  console.log(Address.fromBytes(hash).toBech32())
}

main()
