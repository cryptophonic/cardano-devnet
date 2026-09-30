// Synthetic load: sustained transfers through the SDK's impersonation path, at
// a target rate, drawn from a fork's extracted seeds (`devnet fork seeds`).
//
// CLI:
//   node src/fork/generate.mjs <fork name> --tps T --duration D
//                               [--shape transfer|fanout|mixed] [--amount-ada A]
// or the wrapper: devnet fork generate <n> --tps T --duration D ...
//
// SDK: fork.generate({ tps, duration, shape, amountAda })
//
// Each tick spends from the next seed address in rotation and re-queries that
// address's UTxOs live for every transaction -- no local UTxO bookkeeping.
// That is also "chaining on own outputs when seeds run out": once a seed's
// original UTxO is spent, its own change output is what the provider returns
// next time that address comes up in the rotation. The one thing this does
// NOT protect against is reusing an address again before its previous
// transaction confirms (the provider still reports the now-already-spent
// input); rotating across every seed rather than reusing one repeatedly makes
// that rare in practice, and a rejection from it is reported like any other
// ledger rejection, not treated as a crash -- the same "a rejection is the
// product" stance fork-mode-prompts.md takes for replay.

import { Blaze } from '@blaze-cardano/sdk'
import {
  Address, Credential, CredentialType, Hash28ByteBase16, NetworkId, addressFromCredential
} from '@blaze-cardano/core'
import crypto from 'crypto'

import { openFork } from './index.mjs'

const randomAddress = networkId => addressFromCredential(
  networkId,
  Credential.fromCore({
    hash: Hash28ByteBase16(crypto.randomBytes(28).toString('hex')),
    type: CredentialType.KeyHash
  })
)

/**
 * Drive synthetic transfer load through a fork's seed addresses at a target rate.
 * @param {import('./fork.mjs').Fork} fork
 * @param {{ tps: number, duration: number, shape?: 'transfer'|'fanout'|'mixed',
 *           amountAda?: number, onTick?: (result: object) => void }} opts
 * @returns {Promise<{ requested: number, submitted: number, accepted: number,
 *                     rejected: Array<{ seed: string, error: string }>,
 *                     rate: number, blockEvery: number|null,
 *                     startTip: object, endTip: object,
 *                     blocksPerSecond: number, elapsedMs: number }>}
 */
export async function generateLoad(fork, opts) {
  const { tps, duration, shape = 'transfer', amountAda = 2, onTick } = opts
  if (!(tps > 0)) throw new Error('generate: tps must be > 0')
  if (!(duration > 0)) throw new Error('generate: duration must be > 0')
  if (!['transfer', 'fanout', 'mixed'].includes(shape)) {
    throw new Error(`generate: unknown shape '${shape}' (transfer|fanout|mixed)`)
  }

  const seeds = fork.seeds // throws its own clear error if seeds.json is missing
  const amount = BigInt(Math.round(amountAda * 1_000_000))
  const destination = Address.fromBech32(fork.manifest.producer.address)
  const networkId = fork.manifest.network === 'mainnet' ? NetworkId.Mainnet : NetworkId.Testnet

  const startTip = await fork.tip()
  const startedAt = Date.now()
  const intervalMs = 1000 / tps
  const totalTicks = Math.round(tps * duration)

  let submitted = 0, accepted = 0
  const rejected = []

  for (let i = 0; i < totalTicks; i++) {
    const tickStart = Date.now()
    const seed = seeds[i % seeds.length]
    const useFanout = shape === 'fanout' || (shape === 'mixed' && i % 2 === 1)
    const to = useFanout ? randomAddress(networkId) : destination

    submitted++
    try {
      const signer = fork.impersonate(seed.address)
      const blaze = await Blaze.from(fork.provider, signer)
      const tx = await blaze.newTransaction().payLovelace(to, amount).complete()
      const signed = await signer.sign(tx)
      const txId = await fork.submit(signed, { confirm: false })
      accepted++
      onTick?.({ ok: true, seed: seed.address, to: to.toBech32(), txId })
    } catch (err) {
      const error = err?.message ?? String(err)
      rejected.push({ seed: seed.address, error })
      onTick?.({ ok: false, seed: seed.address, error })
    }

    const wait = intervalMs - (Date.now() - tickStart)
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
  }

  const endTip = await fork.tip()
  const elapsedMs = Date.now() - startedAt

  return {
    requested: totalTicks,
    submitted,
    accepted,
    rejected,
    rate: fork.manifest.clock.rate,
    blockEvery: fork.manifest.blockEvery,
    startTip,
    endTip,
    blocksPerSecond: (endTip.block - startTip.block) / (elapsedMs / 1000),
    elapsedMs
  }
}

// ------------------------------------------------------------------ CLI

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const flag = (name, def) => {
    const i = args.indexOf(`--${name}`)
    return i === -1 ? def : args[i + 1]
  }
  const forkName = args.find(a => !a.startsWith('--'))
  if (!forkName) {
    console.error(
      'usage: node src/fork/generate.mjs <fork name> --tps T --duration D ' +
      '[--shape transfer|fanout|mixed] [--amount-ada A]'
    )
    process.exit(1)
  }

  const fork = await openFork(forkName)
  try {
    const tps = Number(flag('tps', '1'))
    const duration = Number(flag('duration', '10'))
    const shape = flag('shape', 'transfer')
    const amountAda = Number(flag('amount-ada', '2'))

    console.log(
      `generating ${shape} load on '${fork.name}': ${tps} tps for ${duration}s ` +
      `(${Math.round(tps * duration)} tx, ${seedsCount(fork)} seed(s) available)`
    )
    const report = await generateLoad(fork, {
      tps, duration, shape, amountAda,
      onTick: r => console.log(
        r.ok
          ? `  ok      ${r.seed.slice(0, 30)}...  ${r.txId}`
          : `  REJECT  ${r.seed.slice(0, 30)}...  ${r.error.split('\n')[0]}`
      )
    })

    console.log(
      `\nrequested ${report.requested}  submitted ${report.submitted}  ` +
      `accepted ${report.accepted}  rejected ${report.rejected.length}`
    )
    console.log(
      `observed ${report.blocksPerSecond.toFixed(2)} blocks/s at rate ` +
      `x${report.rate} (blockEvery ${report.blockEvery ?? '- (not forging)'}), ` +
      `${report.elapsedMs}ms wall`
    )
    if (report.rejected.length) {
      console.log('\nrejections (ledger error verbatim):')
      for (const r of report.rejected) console.log(`  ${r.seed}\n    ${r.error}`)
    }
    process.exitCode = report.rejected.length === report.submitted ? 1 : 0
  } finally {
    await fork.close()
  }
}

function seedsCount(fork) {
  try { return fork.seeds.length } catch { return 0 }
}
