import { randomBytes } from 'crypto'

import {
  Blaze
} from '@blaze-cardano/sdk'
import { 
  AssetId,
  ScriptPubkey,
  Ed25519KeyHashHex,
  ScriptAll,
  NativeScript,
  Script,
  toHex,
  NetworkId
} from '@blaze-cardano/core'
import {
  HotSingleWallet
} from '@blaze-cardano/wallet'
import { BlazeProviderFrontend } from '../blaze-frontend.mjs'

const keypress = async () => {
  process.stdin.setRawMode(true)
  return new Promise(resolve => process.stdin.once('data', () => {
    process.stdin.setRawMode(false)
    resolve()
  }))
}

const main = async () => {
  const provider = new BlazeProviderFrontend("ws://localhost:1338")
  await provider.init()

  // Create a random wallet, get the address and key hash
  const privKey = randomBytes(32).toString("hex")
  const wallet = new HotSingleWallet(privKey, NetworkId.Testnet, provider)
  const keyHash = wallet.address.toBytes().slice(2)
  console.log("key hash = " + keyHash)

  /* Create a native script tree of the following form:
  {
    "type": "all",
    "scripts": [
      { 
        "type": "sig", 
        "keyHash": "2e03063c4f133ec23b2467b3eccb7c4f433b06264d3ba893bcb72d7f"
      }
    ]
  }
  */
  const pubKeyScript = new ScriptPubkey()
  pubKeyScript.setKeyHash(Ed25519KeyHashHex(keyHash))
  const allScript = new ScriptAll()
  allScript.setNativeScripts([pubKeyScript])

  const nativeScript = NativeScript.newScriptAll(allScript)
  const policyId = nativeScript.hash()

  const tokenName = toHex(Buffer.from("minted-token-name", "utf8"))
  const assetId = AssetId.fromParts(policyId, tokenName)
  console.log("Asset ID = " + assetId)
  const amountsToMint = new Map()
  amountsToMint.set(tokenName, BigInt(1))

  console.log()
  console.log("Please deposit funds to: " + wallet.address.toBech32())
  console.log("<Press any key to continue>")
  await keypress()

  // Build minting transaction
  const blaze = await Blaze.from(provider, wallet)
  const tx = await blaze
    .newTransaction()
    .addMint(policyId, amountsToMint)
    .provideScript(Script.newNativeScript(nativeScript))
    .complete()

  const signedTx = await blaze.signTransaction(tx)
  const txId = await blaze.provider.postTransactionToChain(signedTx.toCbor())
  console.log("Transaction sent: " + txId)

  process.exit()
}

main()
