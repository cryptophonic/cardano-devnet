// The fork SDK's entry point: a Fork is a manifest, a provider and a god key.
//
//   import { openFork } from './src/fork/index.mjs'
//
//   const fork = await openFork('sdk1')
//   const whale = await fork.impersonate(
//     'addr_test1vp8cprhse9pnnv7f4l3n6pj0afq2hjm6f7r2205dz0583egagfjah')
//   const blaze = await Blaze.from(fork.provider, whale)
//   const tx = await blaze.newTransaction().payLovelace(someone, 1_000_000_000n).complete()
//   await fork.submit(await whale.sign(tx))
//
// Lifecycle calls (warpTo, setRate) wrap scripts/devnet-fork; chain calls go to
// the fork's ogmios sidecar. Nothing here starts or stops a node except on
// request: a fork is expensive to build and cheap to reattach to.

import fs from 'fs'

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
      `${process.env.GOLDEN_DB ?? '/mnt/cardano/preview'}/god/god.skey`
    if (!fs.existsSync(godKeyPath)) {
      throw new Error(
        `no god signing key at ${godKeyPath}. It is not kept in the run ` +
        `directory; point openFork at it with { godKeyPath }, or set GOLDEN_DB.`
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
