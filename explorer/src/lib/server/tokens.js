// Per-token metadata the chain itself declares: which image to draw, and how
// many decimals its amounts carry. Without it a token gets a placeholder glyph
// chosen by the order the indexer first saw it (logo_lookup in index.js) and
// its amounts show as raw base units — so the same token lands on a different
// icon, and reads as an implausibly large integer, on every fresh chain.
//
// Whoever created the chain writes runtime/tokens.json:
//
//   { "<policy>:<hex token name>": { "logo": "<image path>", "decimals": 8 } }
//
// A bare string is accepted as shorthand for just a logo. Relative image paths
// resolve against the file's own directory; $TOKEN_METADATA overrides the
// file's location.
//
// The explorer is normally already running when a new chain appears, so the
// file is read lazily and re-read whenever its mtime moves.

import fs from 'fs'
import path from 'path'

const METADATA = process.env.TOKEN_METADATA ??
  path.join(process.env.DEVNET_ROOT ?? '.', 'runtime', 'tokens.json')

// ada is not in the file and never will be; it is the one token every devnet
// has, and its six decimals are a property of Cardano rather than of a chain.
const ADA = { decimals: 6 }

let mtime = null
let map = {}

function metadata() {
  let stat
  try {
    stat = fs.statSync(METADATA)
  } catch {
    mtime = null
    map = {}
    return map
  }
  if (stat.mtimeMs === mtime) return map
  mtime = stat.mtimeMs
  try {
    const parsed = JSON.parse(fs.readFileSync(METADATA, 'utf8'))
    map = Object.keys(parsed).reduce((acc, unit) => {
      acc[unit] = typeof parsed[unit] === 'string' ? { logo: parsed[unit] } : parsed[unit]
      return acc
    }, {})
  } catch (err) {
    // A half-written or malformed file is not worth taking the explorer down
    // for; fall back to the defaults and say so once per change.
    console.error("tokens: ignoring " + METADATA + ": " + err.message)
    map = {}
  }
  return map
}

function entry(policy, token) {
  if (policy === "ada" && token === "lovelace") return ADA
  return metadata()[policy + ":" + token] ?? {}
}

/** Filesystem path of a token's declared image, or undefined. */
export function logoFile(policy, token) {
  const file = entry(policy, token).logo
  if (file === undefined) return undefined
  return path.resolve(path.dirname(METADATA), file)
}

/** What the templates put in <img src="/{logo}"> -- declared, else fallback. */
export function tokenLogo(policy, token, fallback) {
  return logoFile(policy, token) === undefined
    ? fallback
    : "token-logo/" + policy + "/" + token
}

/**
 * Amount as a decimal string, if the token says how many decimals it has.
 * Undeclared tokens keep showing raw base units, which is the honest answer:
 * the explorer has no way to guess, and a wrong guess misstates a balance.
 */
export function formatAmount(amount, policy, token) {
  const decimals = entry(policy, token).decimals
  if (!decimals) return amount
  const digits = "" + amount
  const whole = digits.length > decimals ? digits.slice(0, -decimals) : "0"
  return whole + "." + ("0".repeat(decimals) + digits).slice(-decimals)
}
