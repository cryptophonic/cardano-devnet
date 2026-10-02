// The fork SDK's entry point: a Fork is a manifest, a provider and a god key.
//
//   import { openFork } from './src/fork/index.mjs'
//
//   const fork = await openFork('sdk1')
//   await fork.extractSeeds()               // once per fork; a real --whole-utxo scan
//   const whale = fork.impersonateSeed()    // the biggest seed found, index 0
//   const blaze = await Blaze.from(fork.provider, whale)
//   const tx = await blaze.newTransaction().payLovelace(someone, 1_000_000_000n).complete()
//   await fork.submit(await whale.sign(tx))
//
//   await fork.generate({ tps: 5, duration: 30 })   // synthetic load over `seeds`
//
// Lifecycle calls (warpTo, setRate) wrap scripts/devnet-fork; chain calls go to
// the fork's ogmios sidecar. Nothing here starts or stops a node except on
// request: a fork is expensive to build and cheap to reattach to.

import fs from 'fs'
import path from 'path'

import { Address } from '@blaze-cardano/core'

import { devnetFork, readManifest, resolveRun } from './cli.mjs'
import { ForkProvider } from './provider.mjs'
import { ImpersonatedSigner } from './impersonate.mjs'

export class Fork {

  /**
   * @param {object} parts
   * @param {string} parts.name
   * @param {object} parts.manifest
   * @param {string} parts.runDir
   * @param {ForkProvider} parts.provider
   * @param {string} parts.godKeyPath
   */
  constructor({ name, manifest, runDir, provider, godKeyPath }) {
    this.name = name
    this.manifest = manifest
    this.runDir = runDir
    this.provider = provider
    this.godKeyPath = godKeyPath
  }

  /**
   * Attach to a fork: read its manifest, make sure its ogmios sidecar is up, and
   * connect to it.
   * @param {string} name a fork name, run-<name>, or a run directory path
   * @param {object} [opts]
   * @param {string} [opts.godKeyPath] overrides the manifest's godKeyPath
   * @param {boolean} [opts.ogmios] false to require a sidecar rather than start one
   * @returns {Promise<Fork>}
   */
  static async open(name, opts = {}) {
    const manifest = readManifest(name)
    const runDir = resolveRun(name)

    // `ogmios start` is idempotent-ish: it recreates the sidecar and waits for it
    // to report a node connection, so an already-running one costs one restart.
    // `ogmios url` alone is the cheaper path when it is known to be up.
    const url = opts.ogmios === false
      ? (await devnetFork(['ogmios', 'url', name])).trim()
      : (await devnetFork(['ogmios', 'start', name])).trim().match(/ws:\/\/\S+/)?.[0]
    if (!url) throw new Error(`could not determine the ogmios address for fork '${name}'`)

    const godKeyPath = opts.godKeyPath ?? manifest.godKeyPath ??
      `${process.env.RUNS_DIR ?? '/mnt/cardano/runs'}/keys/god.skey`
    if (!fs.existsSync(godKeyPath)) {
      throw new Error(
        `no god signing key at ${godKeyPath}. It is not kept in the run ` +
        `directory; point openFork at it with { godKeyPath }, or set RUNS_DIR.`
      )
    }

    return new Fork({
      name: manifest.name ?? name,
      manifest,
      runDir,
      provider: await ForkProvider.connect(url),
      godKeyPath
    })
  }

  // ---------------------------------------------------------------- identity

  /** @returns {string} the god key hash the node's gates are set to */
  get godKeyHash() { return this.manifest.godKeyHash }

  /** @returns {number} the slot the fork diverges at */
  get forkSlot() { return this.manifest.fork.slot }

  /** @returns {number} */
  get networkMagic() { return this.manifest.networkMagic }

  // ------------------------------------------------------------- chain state

  /**
   * @returns {Promise<{ slot: number, id: string, block: number, epoch: number }>}
   */
  async tip() {
    const [tip, block, epoch] = await Promise.all([
      this.provider.tip(),
      this.provider.blockHeight(),
      this.provider.epoch()
    ])
    return { slot: tip.slot, id: tip.id, block, epoch }
  }

  /** @returns {Promise<number>} the current epoch */
  async epoch() {
    return this.provider.epoch()
  }

  /**
   * The fork's own "now" -- the forger's faked clock, not the host's.
   *
   * There is no cheap general source for this. Under libfaketime a child process
   * re-anchors the multiplier and reports the bare anchor, so a subprocess
   * cannot be asked; the only honest observable is the forger's own log
   * timestamps, which is what `devnet fork clock` reads. That makes this a
   * producer-only reading, and a stale one when the node is quiet: at rate x1
   * with blockEvery 1 it is a second behind, at x100 it can be further.
   * @returns {Promise<{ slot: number, time: Date, epoch: number, rate: number,
   *                     kesPeriod: number, source: string }>}
   */
  async now() {
    const clock = JSON.parse(await devnetFork(['clock', this.name]))
    return { ...clock, time: new Date(clock.time) }
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Move the chain forward to a slot or an epoch.
   *
   * A warp is not a skip: the ledger can only forecast ~3k/f slots past its tip,
   * so the chain forges through the distance at its cadence and the cost is real
   * time, (target - tip) / rate seconds. Raising the rate is what makes a warp
   * cheaper, which is why `rate` is accepted here.
   * @param {{ slot?: number, epoch?: number, rate?: number,
   *           onOutput?: (chunk: string) => void }} target
   * @returns {Promise<{ slot: number, id: string, block: number, epoch: number }>} the new tip
   */
  async warpTo({ slot, epoch, rate, onOutput } = {}) {
    if ((slot === undefined) === (epoch === undefined)) {
      throw new Error('warpTo needs exactly one of { slot, epoch }')
    }
    const args = ['warp', this.name]
    args.push(...(slot !== undefined ? ['--to-slot', String(slot)] : ['--to-epoch', String(epoch)]))
    if (rate !== undefined) args.push('--rate', String(rate))
    await devnetFork(args, { onOutput })
    this.reload()
    return this.tip()
  }

  /**
   * Change how fast the fork's clock runs, from here on.
   *
   * The cadence gate (blockEvery) is read at node start, so until the next start
   * the chain keeps forging at the old blocks-per-slot -- the clock changes
   * immediately, the cadence does not.
   * @param {number} rate
   * @returns {Promise<string>} what the script reported
   */
  async setRate(rate) {
    const out = await devnetFork(['rate', this.name, String(rate)])
    this.reload()
    return out.trimEnd()
  }

  /** @returns {Promise<string>} the `devnet fork status` report */
  async status() {
    return (await devnetFork(['status', this.name])).trimEnd()
  }

  /** Re-read the manifest after a command that rewrites it. */
  reload() {
    this.manifest = readManifest(this.name)
    return this.manifest
  }

  // ---------------------------------------------------------------- seeds

  /**
   * Every spendable, unencumbered UTxO `devnet fork seeds` found above its
   * value threshold, sorted by value descending, biggest first.
   *
   * Reads `<runDir>/seeds.json` directly rather than `manifest.seeds` (which
   * is only a summary -- `{file, count, minAda, extractedAt}` -- because the
   * full list can run into the thousands of entries on a real chain and
   * doesn't belong embedded in the manifest). `lovelace` is a string in the
   * file for the same reason it is everywhere else in this SDK: the biggest
   * entries on a real chain exceed `Number.MAX_SAFE_INTEGER`, and a bare JSON
   * number would round under a plain `JSON.parse` the way it did in
   * `Ogmios.mjs` before `src/fork/ogmios.mjs` existed (fork-mode-sdk.md 11b).
   * @returns {Array<{ address: string, utxo: string, lovelace: bigint }>}
   */
  get seeds() {
    const file = path.join(this.runDir, 'seeds.json')
    if (!fs.existsSync(file)) {
      throw new Error(
        `no seeds.json for fork '${this.name}'. Run 'devnet fork seeds ${this.name}' first.`
      )
    }
    return JSON.parse(fs.readFileSync(file).toString())
      .map(s => ({ ...s, lovelace: BigInt(s.lovelace) }))
  }

  /**
   * One seed by rank -- `seed()` (or `seed(0)`) is the single biggest
   * spendable UTxO this fork has, the "whale" every impersonation fixture
   * since the god-key phase has used.
   * @param {number} [n=0] index into `seeds`, 0 = biggest
   * @returns {{ address: string, utxo: string, lovelace: bigint }}
   */
  seed(n = 0) {
    const seeds = this.seeds
    const found = seeds[n]
    if (!found) {
      throw new Error(
        `fork '${this.name}' has only ${seeds.length} seed(s); no entry at index ${n}.`
      )
    }
    return found
  }

  /**
   * Extract this fork's spendable UTxOs above a value threshold into
   * `seeds.json`. Wraps `devnet fork seeds`; see that command for why this is
   * a real `--whole-utxo` scan rather than a targeted query.
   * @param {{ minAda?: number, onOutput?: (chunk: string) => void }} [opts]
   * @returns {Promise<Array<{ address: string, utxo: string, lovelace: bigint }>>}
   */
  async extractSeeds({ minAda, onOutput } = {}) {
    const args = ['seeds', this.name]
    if (minAda !== undefined) args.push('--seed-min-ada', String(minAda))
    await devnetFork(args, { onOutput, timeout: 0 })
    this.reload()
    return this.seeds
  }

  // ------------------------------------------------------------ impersonation

  /**
   * A signer that spends `address`'s UTxOs and witnesses with the god key alone.
   * @param {string|Address} address bech32 or a blaze Address; any address, held or not
   * @returns {ImpersonatedSigner}
   */
  impersonate(address) {
    return new ImpersonatedSigner({
      address: typeof address === 'string' ? Address.fromBech32(address) : address,
      godKeyPath: this.godKeyPath,
      godKeyHash: this.godKeyHash,
      provider: this.provider
    })
  }

  /**
   * `impersonate(this.seed(n).address)` -- a signer for a known-funded seed
   * address rather than one the caller has to name.
   * @param {number} [n=0] index into `seeds`, 0 = biggest ("the whale")
   * @returns {ImpersonatedSigner}
   */
  impersonateSeed(n = 0) {
    return this.impersonate(this.seed(n).address)
  }

  /**
   * Submit a signed transaction and wait for it to reach the ledger.
   * @param {import('@blaze-cardano/core').Transaction} tx
   * @param {{ confirm?: boolean, timeout?: number }} [opts]
   * @returns {Promise<string>} the transaction id
   */
  async submit(tx, { confirm = true, timeout = 90_000 } = {}) {
    const txId = await this.provider.postTransactionToChain(tx)
    if (confirm && !await this.provider.awaitTransactionConfirmation(txId, timeout)) {
      throw new Error(
        `transaction ${txId} was accepted by the mempool but did not appear in ` +
        `the ledger within ${timeout}ms. Check the node's Mempool trace: ` +
        `devnet fork stop is not needed, isolated-node logs ${this.name}`
      )
    }
    return txId.toString()
  }

  /**
   * Synthetic transfer load over `seeds`, at a target rate. Wraps
   * `src/fork/generate.mjs` (a dynamic import: that module can also run
   * standalone as `devnet fork generate`'s CLI entry, and importing it
   * statically here would make a cycle back through `index.mjs`).
   * @param {{ tps: number, duration: number, shape?: 'transfer'|'fanout'|'mixed',
   *           amountAda?: number, onTick?: (r: object) => void }} opts
   * @returns {Promise<object>} see `generateLoad` in generate.mjs
   */
  async generate(opts) {
    const { generateLoad } = await import('./generate.mjs')
    return generateLoad(this, opts)
  }

  /**
   * Replay real transactions from a source chain onto this fork, re-witnessed
   * with the god key. Wraps `src/fork/replay.mjs` the same dynamic-import way
   * `generate` wraps generate.mjs.
   * @param {{ source: string, fromSlot: number, toSlot: number, stopOnDivergence?: boolean,
   *           rate?: number, dump?: string, onEvent?: (e: object) => void }} opts
   * @returns {Promise<object>} see `replayFrom` in replay.mjs
   */
  async replay(opts) {
    const { replayFrom } = await import('./replay.mjs')
    return replayFrom(this, opts)
  }

  /**
   * Capture this fork's own real chain history into a single JSON file, for
   * `replay({ source: 'file:<path>' })` to read back with no live connection
   * at all. Wraps `src/fork/extract.mjs` the same dynamic-import way
   * `generate`/`replay` wrap their own modules.
   * @param {{ fromSlot: number, toSlot: number, out: string, onBlock?: (b: object) => void }} opts
   * @returns {Promise<{ blocks: number, transactions: number, out: string }>}
   */
  async extractChain(opts) {
    const { extractChain } = await import('./extract.mjs')
    return extractChain(this, opts)
  }

  // ------------------------------------------------------------ governance

  /**
   * Propose a governance action. Pure CLI wrapper -- unlike generate/replay,
   * building governance certs/votes needs no Blaze at all, so there is no
   * matching .mjs module, just `devnet fork propose` (scripts/devnet-fork).
   * @param {'info'|'param-change'|'no-confidence'|'update-committee'} type
   * @param {string[]} [flags] extra cardano-cli flags for that action type,
   *   e.g. ['--min-pool-cost', '123456789']
   * @returns {Promise<{ action: string, actionFile: string }>} action is "TXID#IX"
   */
  async propose(type, flags = []) {
    const out = await devnetFork(['propose', this.name, type, ...flags])
    const action = out.match(/^proposed \S+: action (\S+)/m)?.[1]
    const actionFile = out.match(/^\s*action file: (\S+)/m)?.[1]
    if (!action) throw new Error(`propose: could not find an action id in:\n${out}`)
    return { action, actionFile }
  }

  /**
   * Vote on a governance action as a group of DReps, SPOs or the committee.
   * @param {string} action "TXID#IX"
   * @param {'drep:all'|`drep:top:${number}`|'spo:all'|`spo:top:${number}`|'cc'} as
   * @param {'yes'|'no'|'abstain'} choice
   * @param {{ ccScripts?: string }} [opts]
   * @returns {Promise<string>} the voting transaction's id
   */
  async vote(action, as, choice, { ccScripts } = {}) {
    const args = ['vote', this.name, '--action', action, '--as', as, `--${choice}`]
    if (ccScripts) args.push('--cc-scripts', ccScripts)
    const out = await devnetFork(args)
    return out.trim().split('\n').pop()
  }

  /**
   * NoConfidence, voted through with enough DReps/SPOs to clear both
   * thresholds, then warped across the boundary -- so a later `propose`
   * no longer needs any committee vote to ratify (fork-mode-governance.md).
   * @param {{ drepTop?: number, spoTop?: number, onOutput?: (chunk: string) => void }} [opts]
   */
  async replaceCommittee({ drepTop, spoTop, onOutput } = {}) {
    const args = ['replace-committee', this.name]
    if (drepTop !== undefined) args.push('--drep-top', String(drepTop))
    if (spoTop !== undefined) args.push('--spo-top', String(spoTop))
    return devnetFork(args, { onOutput, timeout: 0 })
  }

  async close() {
    await this.provider.close()
  }

}

/**
 * @param {string} name
 * @param {object} [opts] see {@link Fork.open}
 * @returns {Promise<Fork>}
 */
export const openFork = (name, opts) => Fork.open(name, opts)
