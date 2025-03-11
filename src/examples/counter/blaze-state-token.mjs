import { 
  AssetId,
  ScriptPubkey,
  Ed25519KeyHashHex,
  ScriptAll,
  NativeScript,
  toHex
} from '@blaze-cardano/core'

/*
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

const main = async () => {
  const pubKeyScript = new ScriptPubkey()
  pubKeyScript.setKeyHash(Ed25519KeyHashHex("2e03063c4f133ec23b2467b3eccb7c4f433b06264d3ba893bcb72d7f"))
  const allScripts = new ScriptAll()
  allScripts.setNativeScripts([pubKeyScript])
  const nativeScript = NativeScript.newScriptAll(allScripts)
  const policyId = nativeScript.hash()
  const assetId = AssetId.fromParts(policyId, toHex(Buffer.from("counter-token", "utf8"))) 
  console.log(assetId)
}

main()
