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

export const aliasWallet = (name, provider) => {
  const cbor = JSON.parse(fs.readFileSync(process.env.KEYS_PATH + "/" + name + ".skey").toString())
  const decoded = decodeCbor(Buffer.from(cbor.cborHex, 'hex'))
  const privKey = decoded.toString('hex')
  const wallet = new HotSingleWallet(privKey, NetworkId.Testnet, provider)
  return wallet
}