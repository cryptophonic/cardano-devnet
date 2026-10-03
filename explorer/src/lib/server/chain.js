// In-memory chain index fed straight from ogmios chain-sync -- the explorer's
// only data source. This replaces the stored-JSON path (runtime/index, written
// by src/devnet/indexer.mjs): same transformation, same shapes, but held in
// maps and rebuilt by replaying the chain from origin, which a devnet (or a
// fork's post-fork tail) is small enough to make instant.
//
// Rollback handling is truncate-by-replay: these chains never reorg (single
// SPO devnet; a lone fork forges alone), so a RollBackward that actually
// precedes our tip -- a reconnect intersection is the only expected one --
// just drops the store and resyncs from origin rather than unwinding state.
//
// OGMIOS_URL selects the node: the devnet's sidecar by default, or any run's
// own ogmios (a fork, a snapshot clone) to browse that chain instead.

import fs from 'fs'
import { WebSocket } from 'ws'
import { EventEmitter } from 'events'

const OGMIOS_URL = process.env.OGMIOS_URL ?? 'ws://localhost:1337'
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
    this.seedGenesis()
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
  const send = method => ws.send(JSON.stringify({ jsonrpc: '2.0', method: method, id: nextId++ }))

  ws.on('open', () => {
    store.reset()
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      method: 'findIntersection',
      params: { points: ['origin'] },
      id: nextId++
    }))
  })
  ws.on('message', msg => {
    const response = JSON.parse(msg)
    if (response.method === 'findIntersection') {
      send('nextBlock')
    } else if (response.method === 'nextBlock') {
      const r = response.result
      if (r.direction === 'forward') {
        store.applyBlock(r.block)
      } else if (r.point !== 'origin' && store.latest && r.point.slot < store.latest.slot) {
        // a rollback behind our tip: truncate by replay -- reconnect resyncs
        // from origin (never expected on a single-SPO devnet or a lone fork)
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
