// Fork-mode status for the explorer -- deliberately NOT the indexer path
// (src/lib/server/index.js). A fork inherits a real chain's state and
// doesn't run the JSON indexer at all (src/fork/provider.mjs's own comment:
// "indexing preview from origin is not the job"), so there is nothing under
// runtime/index for a fork to browse. This reads a run's manifest.json
// directly and shells two already-existing, targeted queries for the live
// bits -- never a chain scan, same discipline every other fork-mode piece
// (seeds, generate, replay, governance) has kept to.

import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'

const DEVNET_ROOT = process.env.DEVNET_ROOT
const RUNS_DIR = process.env.RUNS_DIR ?? '/mnt/cardano/runs'
const FORK_SCRIPT = path.join(DEVNET_ROOT, 'scripts', 'devnet-fork')
const ISOLATED_NODE = path.join(DEVNET_ROOT, 'scripts', 'isolated-node')

// Same resolution devnet-fork's own resolve_run()/src/fork/cli.mjs's
// resolveRun() use: a bare name, a run-<name> directory name, or a path.
function resolveRun(name) {
  if (name.includes('/')) return path.resolve(name)
  if (name.startsWith('run-')) return path.join(RUNS_DIR, name)
  return path.join(RUNS_DIR, 'run-' + name)
}

// run dir -> container name, matching container_for() in every fork-mode script.
function containerFor(runDir) {
  const base = path.basename(runDir)
  return 'devnet-fork-' + base.replace(/^run-/, '')
}

const run = (file, args) => new Promise(resolve => {
  execFile(file, args, { env: { ...process.env, DEVNET_ROOT } }, (err, stdout) => {
    resolve(err ? null : stdout)
  })
})

async function runningContainers() {
  const out = await run('docker', ['ps', '--filter', 'label=devnet.fork=producer', '--format', '{{.Names}}'])
  return new Set((out ?? '').split('\n').filter(Boolean))
}

function readManifest(runDir) {
  const file = path.join(runDir, 'manifest.json')
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file).toString())
}

/** @returns {Promise<Array<{name: string, running: boolean, manifest: object|null}>>} */
export async function listForks() {
  if (!fs.existsSync(RUNS_DIR)) return []
  const running = await runningContainers()
  return fs.readdirSync(RUNS_DIR)
    .filter(d => d.startsWith('run-'))
    .map(d => {
      const runDir = path.join(RUNS_DIR, d)
      return {
        name: d.replace(/^run-/, ''),
        running: running.has(containerFor(runDir)),
        manifest: readManifest(runDir)
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * @param {string} name
 * @returns {Promise<object|null>} null if no manifest exists for this fork
 */
export async function loadFork(name) {
  const runDir = resolveRun(name)
  const manifest = readManifest(runDir)
  if (!manifest) return null

  const running = (await runningContainers()).has(containerFor(runDir))

  let tip = null, clock = null, clockError = null
  if (running) {
    const tipOut = await run(ISOLATED_NODE, ['cli', '--run', runDir, 'latest', 'query', 'tip', '--testnet-magic', String(manifest.networkMagic)])
    if (tipOut) {
      try { tip = JSON.parse(tipOut) } catch { /* node still starting up */ }
    }
    const clockOut = await run(FORK_SCRIPT, ['clock', name])
    if (clockOut) {
      try { clock = JSON.parse(clockOut) } catch { clockError = 'clock output was not valid JSON' }
    } else {
      clockError = "no forged block yet (devnet fork clock reads the forger's own log)"
    }
  }

  const kesMax = manifest.producer?.kesPeriodsValid
  const kesIssued = manifest.producer?.opcertKesPeriod
  const kesRemaining = clock && kesMax !== undefined && kesIssued !== undefined
    ? kesIssued + kesMax - clock.kesPeriod
    : null

  // Same approximation devnet-fork's own cmd_reset uses: (tip - fork slot) / blockEvery.
  const blocksSinceFork = tip && manifest.blockEvery
    ? Math.floor((tip.slot - manifest.fork.slot) / manifest.blockEvery)
    : null

  return { name, running, manifest, tip, clock, clockError, kesRemaining, blocksSinceFork }
}
