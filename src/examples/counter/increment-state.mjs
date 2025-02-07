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
const CounterSchema = Data.Object({
  counter: Data.Integer()
})

const main = async () => {
  if (process.argv.length !== 3) {
    console.log("Usage: node increment-state.mjs <wallet_name>")
    process.exit()
  }

  const provider = new LucidProviderFrontend("ws://localhost:1338")
  await provider.init()
  const lucid = await Lucid(provider, "Custom")

  const wallet_name = process.argv[2]
  console.log("Using wallet: " + wallet_name)
  lucid.selectWallet.fromPrivateKey(loadPrivateKey(wallet_name))

  // Get the state token policyId + name
  const script = JSON.parse(fs.readFileSync("state-token.script"))
  const mintingPolicy = scriptFromNative(script)
  const policyId = mintingPolicyToId(mintingPolicy)
  const unit = policyId + fromText("counter-token")
  console.log("Policy ID = " + policyId)

  // Load the script and compute the script address from it
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
  console.log("Script address = " + scriptAddr)
  console.log(JSON.stringify(validator))

  // Query the latest utxo with the NFT token. Our custom provider backend
  // includes utxos created by mempool transactions and removes utxos
  // that are spent by mempool transactions but have not yet been included
  // into a block.
  const scriptUtxos = await lucid.utxosAtWithUnit(scriptAddr, unit) 
  if (scriptUtxos.length === 0) {
    throw Error("No state utxos found")
  }
  // Sanity check that we only have one state utxo
  if (scriptUtxos.length > 1) {
    throw Error("Multiple state utxos encountered")
  }
  // Pull the datum from the state utxo. This is the current "state" of the
  // script.
  const stateUtxo = scriptUtxos[0]
  console.log(JSON.stringify(stateUtxo))

  // Deserialize using the state schema
  const state = Data.from(stateUtxo.datum, CounterSchema)

  console.log(stateUtxo.datum)

  const current = state.counter
  console.log("State counter is currently " + current)
  state.counter++
  console.log("Next state is " + state.counter)

  console.log("wallet = " + await lucid.wallet().address())

  const datum = Data.to(state, CounterSchema)
  console.log("Datum=" + datum)

  try {

    console.log("here 1")
    const tx = await lucid.newTx()
      .collectFrom([stateUtxo], Data.to(100n))
      .attach.SpendingValidator(validator)
      .pay.ToContract(scriptAddr, { kind: "inline", value: datum }, { [unit]: 1n })
      .complete({ localUPLCEval: false })

    console.log("here 2")
    const signedTx = await tx.sign.withWallet().complete()
    console.log("here 3")
    const txHash = await signedTx.submit()
    console.log("Transaction sent: " + txHash)

  } catch (err) {
    console.log("Caught error: " + err)
    //console.log(err.stack)
  }

  process.exit()
}

main()
