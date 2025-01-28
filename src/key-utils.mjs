import { decode as decodeCbor } from 'cbor-x'
import bech32 from 'bech32-buffer'

export const loadAddress = name => {
  const bech32Addr = fs.readFileSync(process.env.ADDR_PATH + "/" + name + ".addr").toString()
  console.log("Loaded address [" + name + "] = " + bech32Addr)
  return bech32Addr
}

export const loadPrivateKey = name => {
  const cbor = JSON.parse(fs.readFileSync(process.env.KEYS_PATH + "/" + name + ".skey").toString())
  const decoded = decodeCbor(Buffer.from(cbor.cborHex, 'hex'))
  const privKey = bech32.encode("ed25519_sk", decoded)
  return privKey
}

