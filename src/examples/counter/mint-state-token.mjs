import fs from 'fs'

import { 
  Lucid,
  scriptFromNative,
  mintingPolicyToId,
  fromText 
} from '@lucid-evolution/lucid'
import { LucidProviderFrontend } from '../../lucid-frontend.mjs'
import { loadAddress, loadPrivateKey } from '../../key-utils.mjs'

const main = async () => {
  const provider = new LucidProviderFrontend("ws://localhost:1338")
  await provider.init()
  const lucid = await Lucid(provider, "Custom")

  // Mint an NFT "state token"
  lucid.selectWallet.fromPrivateKey(loadPrivateKey("owner"))

  // Get the state token policyId + name
  const script = JSON.parse(fs.readFileSync("state-token.script"))
  const mintingPolicy = scriptFromNative(script)
  const policyId = mintingPolicyToId(mintingPolicy)
  console.log("Policy ID: " + policyId)
  const unit = policyId + fromText("counter-token")
  console.log("Minting state token: " + unit)

  try {

    const tx = await lucid.newTx()
      .mintAssets({ [unit]: 1n })
      .attach.MintingPolicy(mintingPolicy)
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
