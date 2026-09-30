// A thin wrapper over scripts/devnet-fork.
//
// The lifecycle already has one implementation, in bash, and it is the one the
// fixtures were produced with. The SDK shells out to it rather than growing a
// second: a clock stamp written by node and a clock stamp written by the script
// have to agree exactly (a stamp re-anchors the speed-up at the read, so a
// disagreement moves the chain's clock), and the only way to guarantee that is
// to have one writer.

import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEVNET_ROOT = process.env.DEVNET_ROOT ?? path.resolve(HERE, '../..')

export const FORK_SCRIPT = path.join(DEVNET_ROOT, 'scripts', 'devnet-fork')
export const RUNS_DIR = process.env.RUNS_DIR ?? '/mnt/cardano/runs'

/**
 * Run `devnet fork <args...>`.
 * @param {string[]} args
 * @param {{ timeout?: number, onOutput?: (chunk: string) => void }} [opts]
 * @returns {Promise<string>} stdout
 */
export const devnetFork = (args, opts = {}) => new Promise((resolve, reject) => {
  const child = execFile(FORK_SCRIPT, args, {
    env: { ...process.env, DEVNET_ROOT },
    // a warp's output is small but its wall time is (target - tip) / rate
    timeout: opts.timeout ?? 0,
    maxBuffer: 8 * 1024 * 1024
  }, (err, stdout, stderr) => {
    if (err) {
      reject(new Error(
        `devnet fork ${args.join(' ')} failed:\n` +
        (stderr || stdout || err.message).trimEnd()
      ))
      return
    }
    resolve(stdout)
  })
  if (opts.onOutput) {
    child.stdout?.on('data', chunk => opts.onOutput(chunk.toString()))
    child.stderr?.on('data', chunk => opts.onOutput(chunk.toString()))
  }
})

/**
 * A fork name, a run-<name> directory name or a path -- the same three spellings
 * the script accepts -- resolved to a run directory.
 * @param {string} name
 * @returns {string}
 */
export const resolveRun = name => {
  if (name.includes('/')) return path.resolve(name)
  if (name.startsWith('run-')) return path.join(RUNS_DIR, name)
  return path.join(RUNS_DIR, 'run-' + name)
}

/**
 * @param {string} name
 * @returns {object} the fork's manifest
 */
export const readManifest = name => {
  const file = path.join(resolveRun(name), 'manifest.json')
  if (!fs.existsSync(file)) {
    throw new Error(`no manifest at ${file} -- devnet fork adopt ${name}`)
  }
  return JSON.parse(fs.readFileSync(file).toString())
}
