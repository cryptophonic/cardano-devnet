// In-memory chain index fed straight from ogmios chain-sync -- the explorer's
// only data source. This replaces the stored-JSON path (runtime/index, written
// by src/devnet/indexer.mjs): same transformation, same shapes, but held in
// maps and rebuilt by replaying the chain from origin, which a devnet (or a
// fork's post-fork tail) is small enough to make instant.
//
// Rollback handling is truncate-by-replay: these chains never reorg (single
// SPO devnet; a lone fork forges alone), so a RollBackward that actually
// precedes our tip -- a reconnect intersection is the only expected one --
// just drops the store and resyncs from the start point rather than unwinding
// state.
//
// OGMIOS_URL selects the node: the devnet's sidecar by default, or any run's
// own ogmios (a fork, a snapshot clone) to browse that chain instead.
//
// CHAIN_SYNC_FROM picks where indexing starts, and defaults to origin: a
// devnet replays from origin however long it has been up. Height is NOT a
// default gate here. A devnet that has simply been running a while is still a
// devnet -- the one on apollo passed 29000 blocks on six days of uptime and
// would cross any six-figure threshold inside a month -- and silently
// dropping its history at the next restart, weeks after whatever change
// introduced the threshold, is worse than indexing from origin. Only a chain
// that *inherited* millions of blocks needs bounding, which the chain itself
// cannot tell you; the operator can. The values:
//
//   origin          replay everything (the default)
//   tip             follow from the current tip, no history
//   <slot>.<hash>   follow from a known point, e.g. a fork's fork.slot
//   auto            origin below ORIGIN_SYNC_MAX_BLOCKS (default 100000),
//                   the tip above it -- for a host that does not know in
//                   advance which kind of chain it will be pointed at
//
// Outputs created before the start point are unknown to the index, so their
// spends are skipped (applyTransaction already tolerates that).

import fs from 'fs'
import { WebSocket } from 'ws'
import { EventEmitter } from 'events'

const OGMIOS_URL = process.env.OGMIOS_URL ?? 'ws://localhost:1337'
const CHAIN_SYNC_FROM = process.env.CHAIN_SYNC_FROM
const ORIGIN_SYNC_MAX_BLOCKS = parseInt(process.env.ORIGIN_SYNC_MAX_BLOCKS ?? '100000')
const GURU_ASSETS = process.env.CARDANO_CLI_GURU + '/assets'

// Genesis constants - faucet initial utxo to seed all other tx's. The genesis
// UTxO is never delivered by chain-sync (it is in no block), so it is seeded
// here exactly as the indexer seeded it on disk.
const ADDR_FAUCET = 'addr_test1vztc80na8320zymhjekl40yjsnxkcvhu58x59mc2fuwvgkc332vxv'
const GENESIS_FAUCET_HASH = '8c78893911a35d7c52104c98e8497a14d7295b4d9bf7811fc1d4e9f449884284'
const GENESIS_FAUCET_LOVELACE = 900000000000

export const PAGE_LENGTH = 25

class ChainStore extends EventEmitter {

  constructor() {
    super()
    this.setMaxListeners(0)
    this.reset()
  }

  reset() {
    this.blocks = new Map()      // block id -> {id, height, slot, ancestor, transactions[], page}
    this.byHeight = new Map()    // height -> block id
    this.txs = new Map()         // tx id -> {id, index, fee, inputs[], outputs[], producedHeight, blockId, ...}
    this.txOrder = []            // tx ids in index order (genesis = 0)
    this.outputs = new Map()     // "txid#ix" -> ogmios output (+ spentBy/spentHeight/redeemer once spent)
    this.addresses = new Map()   // address -> {ledger, history[], unspent[]}
    this.tokenMeta = {}          // policy -> token -> {index, amount}
    this.tokenLedgers = new Map()// "policy:token" -> {address: amount}
    this.aliases = new Map()     // address -> alias (renames override the guru file)
    this.latest = null
    this.tokenIndex = 1
    this.txIndex = 1
    this.systemStart = null      // epoch ms of slot 0, from queryNetwork/startTime
    this.eras = []               // ogmios eraSummaries, for slot length
    this.seedGenesis()
  }

  /**
   * Wall-clock time of a slot, in epoch ms, or null before the chain's start
   * time is known. Walks the era summaries rather than assuming one second a
   * slot, so a chain whose slot length has ever changed still dates correctly.
   */
  slotTime(slot) {
    if (this.systemStart === null || slot === undefined || slot === null) return null
    let era = null
    for (const e of this.eras) if (e.start.slot <= slot) era = e
    if (era === null) return this.systemStart + slot * 1000
    const length = era.parameters?.slotLength?.milliseconds ?? 1000
    return this.systemStart + era.start.time.seconds * 1000 + (slot - era.start.slot) * length
  }

  address(addr) {
    let a = this.addresses.get(addr)
    if (a === undefined) {
      a = { ledger: {}, history: [], unspent: [] }
      this.addresses.set(addr, a)
    }
    return a
  }

  alias(addr) {
    if (this.aliases.has(addr)) return this.aliases.get(addr)
    try {
      return fs.readFileSync(GURU_ASSETS + '/alias/' + addr + '.alias').toString().trim()
    } catch (notFound) {
      return undefined
    }
  }

  seedGenesis() {
    this.outputs.set(GENESIS_FAUCET_HASH + '#0', {
      address: ADDR_FAUCET,
      value: { ada: { lovelace: GENESIS_FAUCET_LOVELACE } }
    })
    this.txs.set(GENESIS_FAUCET_HASH, {
      id: GENESIS_FAUCET_HASH,
      index: 0,
      producedHeight: 0,
      fee: { ada: { lovelace: 0 } },
      inputs: [],
      outputs: [ADDR_FAUCET]
    })
    this.txOrder.push(GENESIS_FAUCET_HASH)
    const faucet = this.address(ADDR_FAUCET)
    faucet.ledger = { ada: { lovelace: GENESIS_FAUCET_LOVELACE } }
    faucet.unspent = [GENESIS_FAUCET_HASH + '#0']
    this.aliases.set(ADDR_FAUCET, 'faucet')
    this.tokenMeta = { ada: { lovelace: { index: 0, amount: GENESIS_FAUCET_LOVELACE } } }
    this.tokenLedgers.set('ada:lovelace', { [ADDR_FAUCET]: GENESIS_FAUCET_LOVELACE })
  }

  produce(output) {
    const balances = this.address(output.address).ledger
    Object.keys(output.value).forEach(pid => {
      Object.keys(output.value[pid]).forEach(tn => {
        const amt = output.value[pid][tn]
        if (balances[pid] === undefined) balances[pid] = {}
        if (balances[pid][tn] === undefined) balances[pid][tn] = 0
        balances[pid][tn] += amt
        if (this.tokenMeta[pid] === undefined) this.tokenMeta[pid] = {}
        if (this.tokenMeta[pid][tn] === undefined) {
          this.tokenMeta[pid][tn] = { index: this.tokenIndex++, amount: 0 }
        }
        this.tokenMeta[pid][tn].amount += amt
        let ledger = this.tokenLedgers.get(pid + ':' + tn)
        if (ledger === undefined) {
          ledger = {}
          this.tokenLedgers.set(pid + ':' + tn, ledger)
        }
        if (ledger[output.address] === undefined) ledger[output.address] = 0
        ledger[output.address] += amt
      })
    })
  }

  consume(output) {
    const balances = this.address(output.address).ledger
    Object.keys(output.value).forEach(pid => {
      Object.keys(output.value[pid]).forEach(tn => {
        const amt = output.value[pid][tn]
        if (balances[pid] === undefined) balances[pid] = {}
        if (balances[pid][tn] === undefined) balances[pid][tn] = 0
        balances[pid][tn] -= amt
        this.tokenMeta[pid][tn].amount -= amt
        this.tokenLedgers.get(pid + ':' + tn)[output.address] -= amt
      })
    })
  }

  applyTransaction(block, tx) {
    const dbTx = {
      id: tx.id,
      index: this.txIndex++,
      spends: tx.spends,
      fee: tx.fee,
      validityInterval: tx.validityInterval,
      signatories: tx.signatories,
      producedHeight: block.height,
      blockId: block.id,
      slot: block.slot,
      inputs: tx.inputs.map(i => i.transaction.id + '#' + i.index),
      outputs: tx.outputs.map(o => o.address)
    }
    if (tx.scripts !== undefined) {
      dbTx.scripts = Object.keys(tx.scripts).map(cred => ({
        cred: cred,
        cbor: tx.scripts[cred].cbor
      }))
    }
    let redeemers = {}
    if (tx.redeemers !== undefined) {
      redeemers = Object.keys(tx.redeemers).reduce((acc, r) => {
        const [type, indx] = r.split(':')
        acc[indx] = { type: type, data: tx.redeemers[r].redeemer }
        return acc
      }, {})
    }
    tx.inputs.forEach((input, index) => {
      const ref = input.transaction.id + '#' + input.index
      const spent = this.outputs.get(ref)
      if (spent === undefined) return // input from before this chain's origin: impossible on a devnet
      this.consume(spent)
      if (redeemers[index] !== undefined) spent.redeemer = redeemers[index]
      spent.spentBy = tx.id
      spent.spentHeight = block.height
      const addr = this.address(spent.address)
      if (addr.history.length === 0 || addr.history[addr.history.length - 1].id !== tx.id) {
        addr.history.push({ block: block.height, id: tx.id })
      }
      addr.unspent = addr.unspent.filter(u => u !== ref)
    })
    tx.outputs.forEach((output, index) => {
      this.outputs.set(tx.id + '#' + index, output)
      this.produce(output)
      this.address(output.address).unspent.push(tx.id + '#' + index)
    })
    this.txs.set(tx.id, dbTx)
    this.txOrder.push(tx.id)
  }

  applyBlock(block) {
    const dbBlock = {
      id: block.id,
      height: block.height,
      slot: block.slot,
      ancestor: block.ancestor,
      page: Math.floor(block.height / PAGE_LENGTH),
      transactions: block.transactions.map(tx => tx.id)
    }
    this.blocks.set(dbBlock.id, dbBlock)
    this.byHeight.set(dbBlock.height, dbBlock.id)
    block.transactions.forEach(tx => this.applyTransaction(block, tx))
    this.latest = dbBlock
    this.emit('block', dbBlock)
  }
}

function connect(store) {
  const ws = new WebSocket(OGMIOS_URL)
  let nextId = 0
  const send = (method, params) => {
    const id = nextId++
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: method, params: params, id: id }))
    return id
  }
  const intersect = point => send('findIntersection', { points: [point] })

  // Which ids were the clock queries, so a rejection of one can be tolerated
  // while a rejection of anything else reconnects (see the handler below).
  const clockIds = new Set()

  // A slot is only a number until you know when slot zero was and how long a
  // slot lasts: blocks carry slots, not timestamps, so startTime and the era
  // summaries are what date a transaction. They are asked for here but NOT
  // waited on. slotTime runs when a page is read, never when a block is
  // indexed, so a block that arrives first loses nothing -- it dates
  // correctly on every load once the answers land. Waiting cost more than it
  // bought: an ogmios error response carries no `method` field, so a failed
  // query matched no branch below, a readiness counter never reached zero,
  // and the socket sat open and idle indexing nothing until restarted by
  // hand. queryLedgerState needs acquired ledger state, which a node still
  // starting up has not got.
  const startSync = () => {
    if (CHAIN_SYNC_FROM === undefined || CHAIN_SYNC_FROM === 'origin') {
      // the default: replay the whole chain, however long it has been up
      intersect('origin')
    } else if (CHAIN_SYNC_FROM === 'tip') {
      send('queryNetwork/tip')
    } else if (CHAIN_SYNC_FROM === 'auto') {
      send('queryNetwork/blockHeight')
    } else {
      const [slot, id] = CHAIN_SYNC_FROM.split('.')
      intersect({ slot: parseInt(slot), id: id })
    }
  }

  ws.on('open', () => {
    store.reset()
    clockIds.clear()
    clockIds.add(send('queryNetwork/startTime'))
    clockIds.add(send('queryLedgerState/eraSummaries'))
    startSync()
  })
  ws.on('message', msg => {
    const response = JSON.parse(msg)

    // ogmios rejects a malformed request with a bare error and no `method`
    // to dispatch on -- a CHAIN_SYNC_FROM hash of the wrong length or not in
    // base16 arrives here, not in the findIntersection branch below (which
    // only ever sees a well-formed point that simply is not on the chain).
    // Without this the socket stays open and idle and nothing is ever
    // indexed, so match on the id instead: the clock is optional and only
    // costs timestamps, anything else means the sync never started.
    if (response.method === undefined && response.error !== undefined) {
      if (clockIds.has(response.id)) {
        console.log(`chain: ogmios rejected a clock query (${response.error.message}); no times`)
        return
      }
      console.log(`chain: ogmios rejected a request (${response.error.message}); retrying`)
      ws.close()
      return
    }

    if (response.method === 'queryNetwork/startTime') {
      store.systemStart = Date.parse(response.result)
    } else if (response.method === 'queryLedgerState/eraSummaries') {
      store.eras = response.result ?? []
    } else if (response.method === 'queryNetwork/blockHeight') {
      const height = response.result
      if (height === 'origin' || height <= ORIGIN_SYNC_MAX_BLOCKS) {
        intersect('origin')
      } else {
        console.log(`chain: ${height} blocks at ${OGMIOS_URL}; indexing from the tip, not origin`)
        send('queryNetwork/tip')
      }
    } else if (response.method === 'queryNetwork/tip') {
      intersect(response.result)
    } else if (response.method === 'findIntersection') {
      if (response.error !== undefined) {
        console.log(`chain: no intersection at ${CHAIN_SYNC_FROM} (${response.error.message}); retrying`)
        ws.close()
        return
      }
      send('nextBlock')
    } else if (response.method === 'nextBlock') {
      const r = response.result
      if (r.direction === 'forward') {
        store.applyBlock(r.block)
      } else if (r.point !== 'origin' && store.latest && r.point.slot < store.latest.slot) {
        // a rollback behind our tip: truncate by replay -- reconnect resyncs
        // from the start point (never expected on a single-SPO devnet or a
        // lone fork)
        ws.close()
        return
      }
      send('nextBlock')
    }
  })
  ws.on('error', () => {}) // 'close' follows and schedules the retry
  ws.on('close', () => setTimeout(() => connect(store), 2000))
}

// One store per server process, surviving vite HMR re-imports in dev.
export function chainStore() {
  if (globalThis.__devnetChainStore === undefined) {
    const store = new ChainStore()
    connect(store)
    globalThis.__devnetChainStore = store
  }
  return globalThis.__devnetChainStore
}
