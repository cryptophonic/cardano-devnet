// Replay: take real transactions from a source chain and re-witness them with
// the god key alone, to see what a fork's modified rules do with traffic that
// actually happened -- rather than traffic this SDK synthesized (generate.mjs).
//
// CLI:
//   node src/fork/replay.mjs <fork name> --source ogmios:<url>|file:<path>
//                             --from-slot S --to-slot T
//                             [--stop-on-divergence] [--rate R]
// or the wrapper: devnet fork replay <n> --source ... --from-slot S --to-slot T
//
// SDK: fork.replay({ source, fromSlot, toSlot, stopOnDivergence, rate })
//
// Two sources, on purpose: `ogmios:<url>` chain-syncs a LIVE node -- useful,
// but means the source chain has to be up and reachable every time you want
// to replay the same range, which is a real cost for something you'd want to
// run repeatedly against different fork configurations. `file:<path>` reads
// a single JSON file written once by `devnet fork extract` (extract.mjs) --
// an array of the exact same `{slot, id, transactions}` records `ogmiosSource`
// yields, captured up front, replayed any number of times with the source
// chain never touched again. Extract once, replay many times.
//
// Why fromSlot must be >= the fork's own recorded fork point: a fork's chain
// IS the real chain up to that slot, so any transaction from before it is
// already included on the fork too and would just be rejected as
// already-spent. Replay only means something for slots the fork itself never
// saw -- which, without a network connection to whatever the real chain kept
// doing, is only demonstrable here against a SECOND fork made from an EARLIER
// point on the same golden DB (see fork-mode-replay.md). The fork's own
// (slot, hash) is also the one intersection point this code can establish
// without an extra lookup: ogmios' findIntersection needs an exact point, and
// the manifest already carries the fork's.
//
// Clock lock-step is not optional, verified the hard way: an initial anchor
// to `fromSlot` alone leaves the clock running at real wall-clock speed while
// replay works through the blocks far faster than the slots between them
// actually took, so a transaction a few hundred slots in gets rejected
// outright ("outside of its validity interval") against its OWN original
// validity window. So the clock is re-anchored -- via `devnet fork clock-set`
// (scripts/devnet-fork), a live stamp write, no restart, Step 2's doing --
// whenever drift from the block being replayed exceeds `maxDriftSlots`.

import fs from 'fs'

import { HexBlob, Transaction } from '@blaze-cardano/core'

import { skeyWallet } from '../blaze-wallet.mjs'
import { devnetFork } from './cli.mjs'
import { LosslessOgmios } from './ogmios.mjs'
import { openFork } from './index.mjs'

// A stuck promise anywhere in this loop (a wedged websocket, a hung child
// process) must surface as one failed step, not silently freeze the whole
// replay forever -- seen live while building this: a run stalled at 0% CPU
// with no further output, and no amount of waiting resolved it.
const withTimeout = (promise, ms, what) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms))
])

// ---------------------------------------------------------------- sources

/**
 * Chain-sync a real (or another fork's) ogmios instance for blocks in
 * [fromSlot, toSlot], intersecting at a known (slot, id) point. Requires that
 * ogmios to have been started with --include-transaction-cbor (this repo's
 * own fork sidecars are; an arbitrary external one may not be). Shared by
 * `replay` (live source) and `extract` (capture to a file) -- see extract.mjs.
 * @param {string} url ws:// address
 * @param {{ intersect: {slot: number, id: string}, fromSlot: number, toSlot: number }} opts
 */
export async function* ogmiosSource(url, { intersect, fromSlot, toSlot }) {
  const client = await LosslessOgmios.connect(url)
  try {
    await client.findIntersection([intersect])
    let seenForward = false
    for (;;) {
      const res = await client.nextBlock()
      if (res.direction === 'backward') {
        // Chain-sync always rolls back to the intersection point as its FIRST
        // reply, to reset the client's state there -- expected, not divergence.
        // A rollback after that would mean the source chain is not stable.
        if (seenForward) {
          throw new Error(
            `replay source rolled back to slot ${res.point?.slot ?? '(origin)'} while ` +
            `replaying a fixed historical range -- the source chain is not stable`
          )
        }
        continue
      }
      seenForward = true
      const block = res.block
      if (block?.slot === undefined) continue // Byron EBB: no slot, no transactions
      if (block.slot < fromSlot) continue
      if (block.slot > toSlot) break
      yield { slot: block.slot, id: block.id, transactions: block.transactions ?? [] }
    }
  } finally {
    await client.kill()
  }
}

/**
 * A single JSON file previously written by `devnet fork extract` -- a plain
 * array of the exact `{slot, id, transactions}` records `ogmiosSource`
 * yields, in slot order. No live connection of any kind; this is the whole
 * point of `extract`/`file:` existing separately from the live `ogmios:`
 * source. NOT a general raw-block-CBOR reader: decoding an arbitrary
 * Shelley+ block's own CBOR (as opposed to the per-transaction CBOR inside
 * it) needs a full block CDDL decoder, out of scope here.
 * @param {string} file
 * @param {{ fromSlot: number, toSlot: number }} opts
 */
async function* fileSource(file, { fromSlot, toSlot }) {
  const blocks = JSON.parse(fs.readFileSync(file).toString())
  for (const block of blocks) {
    if (block.slot < fromSlot || block.slot > toSlot) continue
    yield block
  }
}

// ------------------------------------------------------------------ replay

/**
 * @param {import('./fork.mjs').Fork} fork
 * @param {{ source: string, fromSlot: number, toSlot: number, stopOnDivergence?: boolean,
 *           rate?: number, maxDriftSlots?: number, onEvent?: (e: object) => void }} opts
 * @returns {Promise<{ sourceTxCount: number, accepted: number,
 *                     rejected: Array<{ txId: string, slot: number, error: string }>,
 *                     perEpoch: Record<number, { accepted: number, rejected: number }>,
 *                     acceptedCountDiff: number }>}
 */
export async function replayFrom(fork, opts) {
  const { source, fromSlot, toSlot, stopOnDivergence = false, rate, onEvent, maxDriftSlots = 50 } = opts
  if (!(toSlot > fromSlot)) throw new Error('replay: --to-slot must be greater than --from-slot')
  if (fromSlot < fork.forkSlot) {
    throw new Error(
      `replay: --from-slot ${fromSlot} is before this fork's own fork point ` +
      `(${fork.forkSlot}) -- a transaction from before the fork is already on ` +
      `this chain and would only be rejected as already-spent`
    )
  }

  const [kind, arg] = source.includes(':') ? source.split(/:(.*)/s) : [null, null]
  if (kind !== 'ogmios' && kind !== 'file') {
    throw new Error(`replay: --source must be ogmios:<url> or file:<path>, got '${source}'`)
  }

  await devnetFork(['clock-set', fork.name, String(fromSlot), ...(rate !== undefined ? ['--rate', String(rate)] : [])])
  let lastAnchoredSlot = fromSlot

  const god = skeyWallet(fork.godKeyPath, fork.provider)
  const epochLength = fork.manifest.genesis.epochLength

  let blocks
  if (kind === 'ogmios') {
    const forkHash = fork.manifest.fork.hash
    if (!forkHash) {
      throw new Error(
        `replay: fork '${fork.name}' has no recorded fork hash (created with an ` +
        `explicit --slot in the volatile range, fork-mode-sdk.md 11e) -- there is ` +
        `no point to intersect the source at`
      )
    }
    blocks = ogmiosSource(arg, { intersect: { slot: fork.forkSlot, id: forkHash }, fromSlot, toSlot })
  } else {
    blocks = fileSource(arg, { fromSlot, toSlot })
  }

  let sourceTxCount = 0, accepted = 0
  const rejected = []
  const perEpoch = {}
  const bump = (epoch, key) => {
    perEpoch[epoch] ??= { accepted: 0, rejected: 0 }
    perEpoch[epoch][key]++
  }

  for await (const block of blocks) {
    const epoch = Math.floor(block.slot / epochLength)

    // Lock-step: a replayed transaction's validity interval is tied to its
    // ORIGINAL slot, and the fork's own clock otherwise just runs at real
    // wall-clock speed from the one-time start anchor -- which falls behind
    // almost immediately, since replay processes blocks far faster than the
    // slots between them actually took. Re-anchor whenever drift from the
    // block being replayed exceeds the threshold (verified live: without
    // this, transactions a few hundred slots past `fromSlot` were rejected
    // outright with "outside of its validity interval").
    if (block.transactions.length > 0 && Math.abs(block.slot - lastAnchoredSlot) > maxDriftSlots) {
      await withTimeout(devnetFork(['clock-set', fork.name, String(block.slot)]), 20_000, 'clock-set')
      lastAnchoredSlot = block.slot
    }

    for (const tx of block.transactions) {
      sourceTxCount++
      if (!tx.cbor) {
        throw new Error(
          `replay: transaction ${tx.id} at slot ${block.slot} has no cbor field -- ` +
          `the source ogmios was not started with --include-transaction-cbor ` +
          `(this repo's own fork sidecars are; an external one may not be)`
        )
      }
      try {
        const decoded = Transaction.fromCbor(HexBlob(tx.cbor))
        const witnessSet = decoded.witnessSet()
        const godWitness = await withTimeout(god.signTransaction(decoded, true), 15_000, 'sign')
        witnessSet.setVkeys(godWitness.vkeys())
        decoded.setWitnessSet(witnessSet)

        const newId = decoded.getId().toString()
        if (newId !== tx.id) {
          throw new Error(
            `replay: re-witnessing changed the transaction id (${tx.id} -> ${newId}) -- ` +
            `a witness-set edit should never touch the body hash; this is a bug, not a rejection`
          )
        }

        const txId = await withTimeout(fork.submit(decoded, { confirm: false }), 15_000, 'submit')
        accepted++
        bump(epoch, 'accepted')
        onEvent?.({ ok: true, slot: block.slot, txId })
      } catch (err) {
        const error = err?.message ?? String(err)
        rejected.push({ txId: tx.id, slot: block.slot, error })
        bump(epoch, 'rejected')
        onEvent?.({ ok: false, slot: block.slot, txId: tx.id, error })
        if (stopOnDivergence) {
          throw new Error(`replay: stopped on divergence at slot ${block.slot}, tx ${tx.id}:\n${error}\ncbor: ${tx.cbor}`)
        }
      }
    }
  }

  return { sourceTxCount, accepted, rejected, perEpoch, acceptedCountDiff: sourceTxCount - accepted }
}

// ------------------------------------------------------------------ CLI

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const flag = (name, def) => {
    const i = args.indexOf(`--${name}`)
    return i === -1 ? def : args[i + 1]
  }
  const forkName = args.find(a => !a.startsWith('--'))
  const src = flag('source')
  const fromSlot = Number(flag('from-slot'))
  const toSlot = Number(flag('to-slot'))
  if (!forkName || !src || !Number.isFinite(fromSlot) || !Number.isFinite(toSlot)) {
    console.error(
      'usage: node src/fork/replay.mjs <fork name> --source ogmios:<url>|file:<path> ' +
      '--from-slot S --to-slot T [--stop-on-divergence] [--rate R]'
    )
    process.exit(1)
  }

  const fork = await openFork(forkName)
  try {
    console.log(`replaying '${fork.name}' from '${src}', slots ${fromSlot}..${toSlot}`)
    const report = await replayFrom(fork, {
      source: src,
      fromSlot,
      toSlot,
      stopOnDivergence: args.includes('--stop-on-divergence'),
      rate: flag('rate') !== undefined ? Number(flag('rate')) : undefined,
      onEvent: e => console.log(
        e.ok
          ? `  ok      slot ${e.slot}  ${e.txId}`
          : `  REJECT  slot ${e.slot}  ${e.txId}  ${e.error.split('\n')[0]}`
      )
    })

    console.log(
      `\nsource txs ${report.sourceTxCount}  accepted ${report.accepted}  ` +
      `rejected ${report.rejected.length}  (diff ${report.acceptedCountDiff})`
    )
    console.log('per-epoch:', JSON.stringify(report.perEpoch))
    if (report.rejected.length) {
      console.log('\nrejections (ledger error verbatim):')
      for (const r of report.rejected) console.log(`  slot ${r.slot}  ${r.txId}\n    ${r.error}`)
    }
    process.exitCode = report.sourceTxCount > 0 && report.accepted === 0 ? 1 : 0
  } finally {
    await fork.close()
  }
}
