#!/usr/bin/env node

// Step 3's required test: through the SDK, spend an arbitrary address's UTxO with
// nothing but the god key, and show that the very same witness set fails a stock
// witness check. No second node is involved -- the stock check is computed from
// the transaction and its resolved inputs (src/fork/stock-witness.mjs).
//
// Usage:
//   node test/fork-sdk-impersonate.mjs [<fork name>] [--address <bech32>]
//
// Needs a running fork (devnet fork start <n>); it starts the ogmios sidecar
// itself. It SPENDS from the impersonated address on that fork, so run it against
// a fork you are willing to advance, never the golden DB.

import { Blaze } from '@blaze-cardano/sdk'
import { Address } from '@blaze-cardano/core'

import { openFork, stockWitnessCheck } from '../src/fork/index.mjs'

// The top preview address by wealth, whose keys nobody in this repo holds. The
// same one every god-key fixture uses, so a result here is comparable to those.
const WHALE = 'addr_test1vp8cprhse9pnnv7f4l3n6pj0afq2hjm6f7r2205dz0583egagfjah'
const PAYMENT = 1_000_000_000n

const args = process.argv.slice(2)
const forkName = args.find(a => !a.startsWith('--')) ?? 'sdk1'
const victim = args.includes('--address') ? args[args.indexOf('--address') + 1] : WHALE

let failures = 0
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? '\n        ' + detail : ''}`)
  if (!ok) failures++
}

const fork = await openFork(forkName)
try {
  console.log(`fork '${fork.name}'  magic ${fork.networkMagic}  fork slot ${fork.forkSlot}`)
  console.log(`god key ${fork.godKeyHash}\n        ${fork.godKeyPath}`)

  const tip = await fork.tip()
  const clock = await fork.now()
  console.log(`tip     slot ${tip.slot}  block ${tip.block}  epoch ${tip.epoch}`)
  console.log(`clock   slot ${clock.slot}  ${clock.time.toISOString()}  x${clock.rate}  (${clock.source})`)

  check(tip.slot > fork.forkSlot, 'the chain has forged past the fork slot',
    `tip ${tip.slot}, fork ${fork.forkSlot}`)

  // --- the impersonated address, and what it holds --------------------------
  const signer = fork.impersonate(victim)
  const before = await signer.getUnspentOutputs()
  check(before.length > 0, `the impersonated address holds UTxOs`,
    `${before.length} at ${victim}`)
  if (before.length === 0) process.exit(1)

  const victimHash = Address.fromBech32(victim).getProps().paymentPart.hash.toString()
  check(victimHash !== fork.godKeyHash,
    'the impersonated address is NOT the god key\'s own address',
    `victim ${victimHash}`)

  // --- build a payment out of the victim's funds ----------------------------
  // The destination is the god key's own address, so the movement is visible
  // without generating a key this test would then have to explain.
  const destination = Address.fromBech32(fork.manifest.producer.address)
  const blaze = await Blaze.from(fork.provider, signer)
  const tx = await blaze.newTransaction()
    .payLovelace(destination, PAYMENT)
    .complete()

  const inputs = [...tx.body().inputs().values()]
  const resolved = await fork.provider.resolveUnspentOutputs(inputs)
  check(resolved.every(u => u.output().address().toBech32() === victim),
    'every input belongs to the impersonated address',
    inputs.map(i => `${i.transactionId()}#${i.index()}`).join(' '))

  // --- sign with the god key alone ------------------------------------------
  const signed = await signer.sign(tx)
  const vkeys = signed.witnessSet().vkeys()?.toCore() ?? []
  check(vkeys.length === 1, 'exactly one vkey witness is attached', `${vkeys.length} witness(es)`)

  const stock = stockWitnessCheck(signed, resolved)
  check(stock.provided.length === 1 && stock.provided[0] === fork.godKeyHash,
    'the one witness is the god key', stock.provided.join(' '))
  check(stock.required.length === 1 && stock.required[0] === victimHash,
    'stock rules would require the victim\'s key', stock.required.join(' '))

  // --- the two halves of the property ---------------------------------------
  check(stock.ok === false, 'the STOCK witness check FAILS on this witness set',
    stock.reason)
  check(stock.missing.length === 1 && stock.missing[0] === victimHash,
    'and the key it says is missing is the victim\'s', stock.missing.join(' '))
  check(stock.extraneous.length === 1 && stock.extraneous[0] === fork.godKeyHash,
    'while the god witness is one stock rules did not ask for', stock.extraneous.join(' '))

  const txId = await fork.submit(signed)
  check(true, 'the FORK accepted it and it reached the ledger', txId)

  // --- and it really moved the funds ----------------------------------------
  const spent = new Set(inputs.map(i => `${i.transactionId()}#${i.index()}`))
  const after = await signer.getUnspentOutputs()
  check(after.every(u => !spent.has(`${u.input().transactionId()}#${u.input().index()}`)),
    'the inputs it spent are gone from the impersonated address')

  const landed = await fork.provider.getUnspentOutputs(destination)
  check(landed.some(u => u.input().transactionId().toString() === txId &&
                         u.output().amount().coin() === PAYMENT),
    `${PAYMENT} lovelace landed at the destination`,
    fork.manifest.producer.address)

} finally {
  await fork.close()
}

console.log(failures === 0
  ? '\nall checks passed'
  : `\n${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
