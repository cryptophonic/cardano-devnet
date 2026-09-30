// Extract: pull a range of real transactions from a live ogmios source into a
// single JSON file, once, so `devnet fork replay --source file:<path>` can
// replay them any number of times without the source chain being up at all.
//
// CLI:
//   node src/fork/extract.mjs <source fork name> --from-slot S --to-slot T --out <file>
// or the wrapper: devnet fork extract <source-fork> --from-slot S --to-slot T --out <file>
//
// SDK: fork.extractChain({ fromSlot, toSlot, out })
//
// <source fork name> is one of THIS repo's own managed forks, not an
// arbitrary URL: its manifest already carries the one (slot, hash) point
// this can intersect a chain-sync at without an extra lookup (see
// replay.mjs), and `devnet fork ogmios url` already knows how to reach its
// sidecar. Extracting from a truly external "any real node" ogmios would
// need that point supplied some other way -- not built here.

import fs from 'fs'

import { devnetFork } from './cli.mjs'
import { openFork } from './index.mjs'
import { ogmiosSource } from './replay.mjs'

/**
 * @param {import('./fork.mjs').Fork} fork the SOURCE fork to extract real history from
 * @param {{ fromSlot: number, toSlot: number, out: string, onBlock?: (b: object) => void }} opts
 * @returns {Promise<{ blocks: number, transactions: number, out: string }>}
 */
export async function extractChain(fork, opts) {
  const { fromSlot, toSlot, out, onBlock } = opts
  if (!(toSlot > fromSlot)) throw new Error('extract: --to-slot must be greater than --from-slot')
  const forkHash = fork.manifest.fork.hash
  if (!forkHash) {
    throw new Error(
      `extract: fork '${fork.name}' has no recorded fork hash (created with an ` +
      `explicit --slot in the volatile range, fork-mode-sdk.md 11e) -- there is ` +
      `no point to intersect the source at`
    )
  }

  const url = (await devnetFork(['ogmios', 'url', fork.name])).trim()
  const blocks = []
  let transactions = 0
  for await (const block of ogmiosSource(url, {
    intersect: { slot: fork.forkSlot, id: forkHash },
    fromSlot,
    toSlot
  })) {
    blocks.push(block)
    transactions += block.transactions.length
    onBlock?.(block)
  }

  fs.writeFileSync(out, JSON.stringify(blocks))
  return { blocks: blocks.length, transactions, out }
}

// ------------------------------------------------------------------ CLI

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const flag = (name, def) => {
    const i = args.indexOf(`--${name}`)
    return i === -1 ? def : args[i + 1]
  }
  const forkName = args.find(a => !a.startsWith('--'))
  const fromSlot = Number(flag('from-slot'))
  const toSlot = Number(flag('to-slot'))
  const out = flag('out')
  if (!forkName || !out || !Number.isFinite(fromSlot) || !Number.isFinite(toSlot)) {
    console.error('usage: node src/fork/extract.mjs <source fork name> --from-slot S --to-slot T --out <file>')
    process.exit(1)
  }

  const fork = await openFork(forkName)
  try {
    console.log(`extracting '${fork.name}', slots ${fromSlot}..${toSlot} -> ${out}`)
    const result = await extractChain(fork, {
      fromSlot,
      toSlot,
      out,
      onBlock: b => { if (b.transactions.length) console.log(`  slot ${b.slot}  ${b.transactions.length} tx`) }
    })
    console.log(`\n${result.blocks} block(s), ${result.transactions} transaction(s) written to ${result.out}`)
  } finally {
    await fork.close()
  }
}
