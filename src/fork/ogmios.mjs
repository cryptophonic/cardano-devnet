// An ogmios client that does not round money.
//
// Why this exists, and why the blaze client cannot be used directly:
//
// A fork inherits a real chain's UTxO set, and real chains hold UTxOs bigger
// than IEEE-754 can count. Preview's top address holds a single output of
// 22,767,614,730,929,897 lovelace; Number.MAX_SAFE_INTEGER is
// 9,007,199,254,740,991. Plain JSON.parse turns that quantity into
// ...929,896 -- quietly, with no error anywhere -- and a transaction balanced
// against the rounded figure is short by one lovelace. The node rejects it:
//
//   ConwayUtxowFailure (UtxoFailure (ValueNotConservedUTxO Mismatch (RelEQ)
//     {supplied: MaryValue (Coin 22767614730929897) …,
//      expected: MaryValue (Coin 22767614730929896) …}))
//
// which is a genuinely baffling error to debug, because every value the client
// can print agrees with itself. See test/fixtures/fork-mode-sdk.md.
//
// A local devnet never hits this -- its balances are small, which is why
// src/devnet/provider.mjs and the blaze ogmios client have not had to care. On a
// fork it is the first transaction you write. So this client scans the raw reply
// text and keeps any integer too large for a Number as a string, which BigInt()
// then reads exactly.
//
// The method names match the subset of @blaze-cardano/ogmios that Kupmios calls,
// so it can be handed to that class in place of its own client.

import { WebSocket } from 'ws'

/**
 * JSON.parse, except that integer literals too large to survive as Numbers come
 * back as strings. Strings in the source are copied through untouched, so a
 * 16-digit hex transaction id is never mistaken for a number.
 * @param {string} text
 * @returns {any}
 */
export const parseLossless = text => {
  let out = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"') {
      let j = i + 1
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue }
        if (text[j] === '"') { j++; break }
        j++
      }
      out += text.slice(i, j)
      i = j
      continue
    }
    // outside a string, a digit or a minus can only begin a number
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = ch === '-' ? i + 1 : i
      const firstDigit = j
      while (j < text.length && text[j] >= '0' && text[j] <= '9') j++
      const literal = text.slice(i, j)
      const isInteger = j > firstDigit && text[j] !== '.' && text[j] !== 'e' && text[j] !== 'E'
      out += isInteger && !Number.isSafeInteger(Number(literal)) ? `"${literal}"` : literal
      i = j
      continue
    }
    out += ch
    i++
  }
  return JSON.parse(out)
}

export class LosslessOgmios {

  /** @param {string} url */
  constructor(url) {
    this.url = url
    this.nextId = 0
    this.pending = new Map()
    this.socket = new WebSocket(url)
    this.socket.on('message', raw => {
      const response = parseLossless(raw.toString())
      const settle = this.pending.get(response.id)
      if (!settle) return
      this.pending.delete(response.id)
      if (response.error !== undefined) {
        // ogmios reports a rejected transaction as a JSON-RPC error; without
        // this the caller's promise is simply never settled
        const { code, message, data } = response.error
        settle.reject(new Error(
          `ogmios ${response.method ?? ''} error ${code}: ${message}` +
          (data === undefined ? '' : `\n${JSON.stringify(data, null, 2)}`)
        ))
      } else {
        settle.resolve(response.result)
      }
    })
    // A socket that dies mid-request must fail every request waiting on it, or
    // the process just hangs with an unsettled promise.
    const abandon = why => {
      for (const [, settle] of this.pending) settle.reject(new Error(`ogmios at ${url}: ${why}`))
      this.pending.clear()
    }
    this.socket.on('close', () => abandon('connection closed'))
    this.socket.on('error', err => abandon(err.message))
    this.ready = new Promise((resolve, reject) => {
      this.socket.once('open', resolve)
      this.socket.once('error', reject)
    })
  }

  /**
   * @param {string} url
   * @returns {Promise<LosslessOgmios>}
   */
  static async connect(url) {
    const client = new LosslessOgmios(url)
    await client.ready
    return client
  }

  /**
   * @param {string} method
   * @param {object} [params]
   * @returns {Promise<any>}
   */
  async request(method, params = {}) {
    await this.ready
    const id = this.nextId++
    const sent = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
    this.socket.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }))
    return sent
  }

  async kill() {
    this.socket.close()
  }

  // --------------------------------- the subset Kupmios calls on its client

  queryLedgerStateProtocolParameters() {
    return this.request('queryLedgerState/protocolParameters')
  }

  submitTransaction(transaction) {
    return this.request('submitTransaction', { transaction })
  }

  evaluateTransaction(transaction, additionalUtxo) {
    return this.request('evaluateTransaction',
      additionalUtxo === undefined ? { transaction } : { transaction, additionalUtxo })
  }

  // ----------------------------------------------- what the fork SDK adds

  queryLedgerStateUtxo(params) {
    return this.request('queryLedgerState/utxo', params)
  }

  queryLedgerStateEpoch() {
    return this.request('queryLedgerState/epoch')
  }

  queryNetworkTip() {
    return this.request('queryNetwork/tip')
  }

  queryNetworkBlockHeight() {
    return this.request('queryNetwork/blockHeight')
  }

  // --------------------------------------------------- chain-sync (replay)

  /**
   * @param {Array<{slot: number, id: string}|'origin'>} points
   * @returns {Promise<{intersection: object, tip: object}>}
   */
  findIntersection(points) {
    return this.request('findIntersection', { points })
  }

  /** @returns {Promise<{direction: 'forward'|'backward', block?: object, point?: object, tip: object}>} */
  nextBlock() {
    return this.request('nextBlock')
  }

}
