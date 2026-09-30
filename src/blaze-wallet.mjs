import fs from 'fs'
import { randomBytes } from 'crypto'
import { decode as decodeCbor } from 'cbor-x'

import {
  NetworkId
} from '@blaze-cardano/core'

import {
  HotSingleWallet
} from '@blaze-cardano/wallet'

export const randomWallet = provider => {
  const privKey = randomBytes(32).toString('hex')
  const wallet = new HotSingleWallet(privKey, NetworkId.Testnet, provider)
  return wallet
}

// A wallet from a cardano-cli signing key file at an arbitrary path. The alias
// tooling is not the only source of keys -- a fork's god key lives beside its
// chain, not in KEYS_PATH.
export const skeyWallet = (path, provider) => {
  const cbor = JSON.parse(fs.readFileSync(path).toString())
  const decoded = decodeCbor(Buffer.from(cbor.cborHex, 'hex'))
  const privKey = decoded.toString('hex')
  return new HotSingleWallet(privKey, NetworkId.Testnet, provider)
}

export const aliasWallet = (name, provider) => {
  return skeyWallet(process.env.KEYS_PATH + "/" + name + ".skey", provider)
}