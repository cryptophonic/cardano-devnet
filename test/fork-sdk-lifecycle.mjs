#!/usr/bin/env node

// The other half of the Step 3 surface: the clock. Exercises fork.tip(),
// fork.now(), fork.epoch(), fork.setRate() and fork.warpTo() against a running
// fork, and checks the claims each of them makes rather than just that they
// return.
//
// Usage:
//   node test/fork-sdk-lifecycle.mjs [<fork name>] [--slots N] [--rate R]
//
// It advances the fork's chain and rewrites its clock stamp, so run it on a fork
// you are willing to move. It puts the rate back where it found it.

import { openFork } from '../src/fork/index.mjs'

const args = process.argv.slice(2)
const forkName = args.find(a => !a.startsWith('--')) ?? 'sdk1'
const slots = Number(args.includes('--slots') ? args[args.indexOf('--slots') + 1] : 60)
const rate = Number(args.includes('--rate') ? args[args.indexOf('--rate') + 1] : 4)

let failures = 0
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? '\n        ' + detail : ''}`)
  if (!ok) failures++
}

const fork = await openFork(forkName)
const originalRate = fork.manifest.clock.rate
try {
  const tip = await fork.tip()
  const clock = await fork.now()
  const epoch = await fork.epoch()
  console.log(`tip     slot ${tip.slot}  block ${tip.block}  epoch ${tip.epoch}`)
  console.log(`clock   slot ${clock.slot}  ${clock.time.toISOString()}  x${clock.rate}`)

  check(epoch === tip.epoch, 'epoch() agrees with tip().epoch', `${epoch} vs ${tip.epoch}`)

  // The forger's clock cannot be behind its own tip -- it stamped that block when
  // it forged it -- and cannot be far ahead either, since it forges every
  // blockEvery slots. This is the one relation worth asserting: a clock that has
  // drifted away from the tip is how a fork stops forging.
  check(clock.slot >= tip.slot - 5,
    'the forger\'s clock is not behind its own tip',
    `clock ${clock.slot}, tip ${tip.slot}`)
  check(clock.rate === originalRate,
    'clock() reports the rate the manifest claims', `x${clock.rate}`)

  // --- setRate --------------------------------------------------------------
  console.log(`\nsetRate(${rate}):`)
  console.log((await fork.setRate(rate)).replace(/^/gm, '  '))
  check(fork.manifest.clock.rate === rate,
    'the manifest now records the new rate', `x${fork.manifest.clock.rate}`)

  const movedOn = await fork.now()
  check(movedOn.slot >= clock.slot,
    'the clock did not go backwards over the rate change',
    `${clock.slot} -> ${movedOn.slot}`)
  check(movedOn.rate === rate, 'and clock() reports the new rate', `x${movedOn.rate}`)

  // --- warpTo ---------------------------------------------------------------
  const from = await fork.tip()
  const target = from.slot + slots
  console.log(`\nwarpTo({ slot: ${target} })  -- ${slots} slots at x${rate}:`)
  const arrived = await fork.warpTo({
    slot: target,
    onOutput: chunk => process.stdout.write(chunk.replace(/^/gm, '  '))
  })
  check(arrived.slot >= target, 'the chain reached the target slot',
    `slot ${arrived.slot} >= ${target}`)
  check(arrived.block > from.block, 'and forged blocks getting there',
    `block ${from.block} -> ${arrived.block}`)
  check(fork.manifest.clock.warpTarget === undefined,
    'the manifest\'s warpTarget was cleared once it arrived')

  // --- refuse to go backwards ----------------------------------------------
  let refused = null
  try {
    await fork.warpTo({ slot: arrived.slot - 1000 })
  } catch (err) {
    refused = err.message
  }
  check(refused?.includes('refusing to go backwards'),
    'warping backwards is refused',
    refused?.split('\n').find(line => line.includes('refusing')) ?? 'no error raised')

  // --- an argument error is caught before anything is touched --------------
  let bothArgs = null
  try {
    await fork.warpTo({ slot: 1, epoch: 1 })
  } catch (err) {
    bothArgs = err.message
  }
  check(bothArgs?.includes('exactly one of'), 'warpTo({ slot, epoch }) is rejected',
    bothArgs ?? 'no error raised')

} finally {
  if (fork.manifest.clock.rate !== originalRate) {
    console.log(`\nputting the rate back to x${originalRate}:`)
    console.log((await fork.setRate(originalRate)).replace(/^/gm, '  '))
  }
  await fork.close()
}

console.log(failures === 0
  ? '\nall checks passed'
  : `\n${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
