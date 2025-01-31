import fs from 'fs'

import {
  Lucid,
  Data,
  scriptFromNative,
  mintingPolicyToId,
  fromText,
  applyParamsToScript,
  validatorToAddress
} from '@lucid-evolution/lucid'
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
  const lucid = await Lucid(provider, "Custom")

  lucid.selectWallet.fromPrivateKey(loadPrivateKey("owner"))

  // Get the state token policyId
  const script = JSON.parse(fs.readFileSync("state-token.script"))
  const mintingPolicy = scriptFromNative(script)
  const policyId = mintingPolicyToId(mintingPolicy)
  const unit = policyId + fromText("counter-token")

  // Get the script address
  const counterScript = JSON.parse(fs.readFileSync("aiken/plutus.json"))
  const incrementValidator = counterScript.validators.find(v => {
    return v.title === "counter.increment.spend"
  })
  const appliedScript = applyParamsToScript(
    incrementValidator.compiledCode,
    [ policyId, fromText("counter-token") ]
  )
  const validator = {
    type: counterScript.preamble.plutusVersion === "v3" ? "PlutusV3" : "PlutusV2",
    script: appliedScript
  }
  const scriptAddr = validatorToAddress("Custom", validator)
  console.log("Script address=" + scriptAddr)

  // Serialize the counter = 0 state to CBOR
  const datum = Data.to(zeroState, CounterSchema)
  console.log("Datum=" + datum)

  try {

    // Create a utxo with counter = 0 and the state NFT token attached
    const tx = await lucid.newTx()
      .pay.ToContract(scriptAddr, { kind: "inline", value: datum }, { [unit]: 1n })
      .complete()

    const signedTx = await tx.sign.withWallet().complete()
    const txHash = await signedTx.submit()
    console.log("Transaction sent: " + txHash)

  } catch (err) {
    console.log("Caught error: " + err)
  }

  process.exit()
}

main()
