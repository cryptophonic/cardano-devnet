import fs from 'fs'

import { Lucid, fromText } from 'lucid-cardano'
import { LucidProviderFrontend } from '../../lucid-frontend.mjs'
import { loadPrivateKey } from '../../key-utils.mjs'

const main = async () => {
  const provider = new LucidProviderFrontend("ws://localhost:1338")
  await provider.init()
  const lucid = await Lucid.new(provider, "Custom")

  // Mint an NFT "state token"
  lucid.selectWalletFromPrivateKey(loadPrivateKey("owner"))

  // Get the state token policyId + name
  const script = JSON.parse(fs.readFileSync("state-token.script"))
  const mintingPolicy = lucid.utils.nativeScriptFromJson(script)
  const policyId = lucid.utils.mintingPolicyToId(mintingPolicy)
  console.log("Policy ID: " + policyId)
  const unit = policyId + fromText("counter-token")
  console.log("Minting state token: " + unit)

  try {

    const tx = await lucid.newTx()
      .mintAssets({ [unit]: 1n })
      .attachMintingPolicy(mintingPolicy)
      .complete()
    const signedTx = await tx.sign().complete()
    const txHash = await signedTx.submit()

  } catch (err) {
    console.log("Caught error: " + err)
  }

  process.exit()
}

main()
