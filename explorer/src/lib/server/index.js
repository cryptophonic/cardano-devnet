// Read side of the explorer, over the in-memory ogmios-fed index (chain.js).
// Exports and shapes are unchanged from the stored-JSON era so the routes
// didn't have to move; only the data source did.

import fs from 'fs'
import { chainStore, PAGE_LENGTH } from './chain.js'
import { tokenLogo, formatAmount } from './tokens.js'

const GURU_ASSETS = process.env.CARDANO_CLI_GURU + "/assets"

// Placeholder glyphs, picked by the order the indexer first saw each token.
// tokens.js overrides these per token where a chain has said what it wants.
const logo_lookup = [
  "cardano-ada-logo.svg",
  "svg/bolt.svg",
  "svg/gear.svg",
  "svg/cone.svg",
  "svg/flag.svg",
  "svg/flame.svg",
  "svg/flower.svg",
  "svg/locked.svg"
]

function small_hash(hash) {
  return hash.slice(0, 6) + ".." + hash.slice(-6)
}

function small_addr(addr) {
  return addr.slice(0, 15) + ".." + addr.slice(-6)
}

function formatADA(lovelace) {
  return formatAmount(lovelace, "ada", "lovelace")
}

function flattenValue(value) {
  return Object.keys(value).reduce((acc, kpolicy) => {
    Object.keys(value[kpolicy]).map(ktoken => {
      // ada keeps its lovelace figure here; the caller formats it as obj.value.ada
      acc[kpolicy + ":" + ktoken] = kpolicy === "ada"
        ? value[kpolicy][ktoken]
        : formatAmount(value[kpolicy][ktoken], kpolicy, ktoken)
    })
    return acc
  }, {})
}

export function loadBlock(path) {
  const store = chainStore()
  // "/blocks/<id>/block" or "/chain/<height>/block", as the routes always
  // passed; height resolves through the by-height map
  const part = path.split("/")
  const id = part[1] === "chain" ? store.byHeight.get(parseInt(part[2])) : part[2]
  const block = store.blocks.get(id)
  if (block === undefined) throw new Error("no such block: " + path)
  const txs = block.transactions.map(t => {
    const tobj = store.txs.get(t)
    return {
      hash: [t, small_hash(t)],
      inputCount: tobj.inputs.length,
      outputCount: tobj.outputs.length
    }
  })
  return {
    hash: [block.id, small_hash(block.id)],
    height: block.height,
    page: block.page,
    slot: block.slot,
    time: store.slotTime(block.slot),
    latest: store.latest.height,
    txs: txs
  }
}

export function loadLatest() {
  const store = chainStore()
  // The node (or its ogmios) may not be up yet, or no block is forged yet;
  // degrade to an empty devnet rather than taking down every route that
  // loads this through +layout.server.js.
  if (store.latest === null) return { height: 0, tokens: {} }
  const latest = { ...store.latest }
  latest.tokens = Object.keys(store.tokenMeta).reduce((acc, kpolicy) => {
    Object.keys(store.tokenMeta[kpolicy]).map(ktoken => {
      const meta = store.tokenMeta[kpolicy][ktoken]
      const amount = formatAmount(meta.amount, kpolicy, ktoken)
      acc[small_hash(kpolicy) + ":" + ktoken] = {
        logo: tokenLogo(kpolicy, ktoken, logo_lookup[meta.index]),
        amount: amount,
        policy: kpolicy,
        token: ktoken
      }
    })
    return acc
  }, {})
  return latest
}

export async function waitBlock() {
  const store = chainStore()
  return await new Promise(resolve => {
    store.once('block', () => resolve(loadLatest()))
  })
}

export function loadTransaction(hash) {
  const store = chainStore()
  const dbTx = store.txs.get(hash)
  if (dbTx === undefined) throw new Error("no such transaction: " + hash)
  const tx = { ...dbTx }
  tx.hash = [tx.id, small_hash(tx.id)]
  if (tx.blockId !== undefined) {
    tx.block = [tx.blockId, small_hash(tx.blockId)]
    tx.blockHeight = store.blocks.get(tx.blockId).height
    tx.time = store.slotTime(tx.slot)
  } else {
    tx.block = ["genesis", "genesis"]
    tx.blockHeight = 0
    tx.time = null // the seeded faucet UTxO predates the chain
  }
  tx.inputs = tx.inputs.map(input => {
    const [ intx, index ] = input.split("#")
    const val = store.outputs.get(input)
    const obj = {
      hash: [intx, small_hash(intx)],
      ref: index,
      addr: [val.address, small_addr(val.address)],
      alias: store.alias(val.address),
      value: flattenValue(val.value)
    }
    obj.tokenCount = Object.keys(obj.value).length - 1
    obj.value["ada"] = formatADA(obj.value["ada:lovelace"])
    return obj
  })
  tx.outputs = tx.outputs.map((output, index) => {
    const val = store.outputs.get(tx.id + "#" + index)
    const obj = {
      addr: [output, small_addr(output)],
      alias: store.alias(output),
      ref: index,
      value: flattenValue(val.value),
      spentBy: val.spentBy === undefined ? "unspent" : [val.spentBy, small_hash(val.spentBy)]
    }
    obj.tokenCount = Object.keys(obj.value).length - 1
    obj.value["ada"] = formatADA(obj.value["ada:lovelace"])
    return obj
  })
  if (tx.fee !== undefined) {
    tx.fee = formatADA(tx.fee.ada.lovelace)
  }
  return tx
}

export function loadUtxo(hash, ref) {
  const store = chainStore()
  const txData = store.txs.get(hash)
  const utxoData = store.outputs.get(hash + "#" + ref)
  if (txData === undefined || utxoData === undefined) throw new Error("no such utxo: " + hash + "#" + ref)
  const utxo = {
    hash: [hash, small_hash(hash)],
    ref: ref,
    addr: [utxoData.address, small_addr(utxoData.address)],
    alias: store.alias(utxoData.address),
    datum: utxoData.datum,
    redeemer: utxoData.redeemer,
    value: Object.keys(utxoData.value).reduce((acc, kpolicy) => {
      Object.keys(utxoData.value[kpolicy]).map(ktoken => {
        acc[kpolicy + ":" + ktoken] = {
          policy: [kpolicy, small_hash(kpolicy)],
          token: ktoken,
          logo: tokenLogo(kpolicy, ktoken, logo_lookup[store.tokenMeta[kpolicy][ktoken].index]),
          // ada keeps its raw lovelace figure here, as in flattenValue: it is
          // formatted once below as utxo.ada. formatAmount is a string
          // operation and is NOT idempotent -- applied twice it reads the "."
          // it just inserted as a digit, turning 9.000000 into 9..000000.
          amount: kpolicy === "ada"
            ? utxoData.value[kpolicy][ktoken]
            : formatAmount(utxoData.value[kpolicy][ktoken], kpolicy, ktoken)
        }
      })
      return acc
    }, {}),
    producedHeight: txData.producedHeight,
    spentBy: "unspent",
    spentHeight: utxoData.spentHeight
  }
  if (utxoData.spentBy !== undefined) {
    utxo.spentBy = [utxoData.spentBy, small_hash(utxoData.spentBy)]
  }
  utxo.ada = formatADA(utxo.value["ada:lovelace"].amount)
  delete utxo.value["ada:lovelace"]
  utxo.hasNativeTokens = Object.keys(utxo.value).length > 0
  return utxo
}

export function loadAddress(addr) {
  const store = chainStore()
  const entry = store.addresses.get(addr) ?? { ledger: {}, history: [], unspent: [] }
  const ledger = Object.keys(entry.ledger).reduce((acc, kpolicy) => {
    Object.keys(entry.ledger[kpolicy]).map(ktoken => {
      acc[kpolicy + ":" + ktoken] = {
        policy: [kpolicy, small_hash(kpolicy)],
        token: ktoken,
        logo: tokenLogo(kpolicy, ktoken, logo_lookup[store.tokenMeta[kpolicy][ktoken].index]),
        // Raw lovelace for ada; formatted once below as obj.ada. See loadUtxo.
        amount: kpolicy === "ada"
          ? entry.ledger[kpolicy][ktoken]
          : formatAmount(entry.ledger[kpolicy][ktoken], kpolicy, ktoken)
      }
    })
    return acc
  }, {})
  const obj = {
    address: [addr, small_addr(addr)],
    alias: store.alias(addr),
    ledger: ledger,
    // Newest first: an address with a long history is being read to find out
    // what just happened to it, not what happened to it first.
    history: entry.history.map(h => {
      const blockId = store.byHeight.get(h.block)
      return {
        block: h.block,
        id: [h.id, small_hash(h.id)],
        time: blockId === undefined ? null : store.slotTime(store.blocks.get(blockId).slot)
      }
    }).reverse(),
    unspent: entry.unspent.map(u => {
      const sp = u.split("#")
      return {
        id: [sp[0], small_hash(sp[0])],
        ref: sp[1]
      }
    })
  }
  try {
    obj.ada = formatADA(obj.ledger["ada:lovelace"].amount)
  } catch (err) {
    obj.ada = 0
  }
  delete obj.ledger["ada:lovelace"]
  obj.hasNativeTokens = Object.keys(obj.ledger).length > 0
  return obj
}

export function loadToken(policy, token) {
  const store = chainStore()
  const tokData = store.tokenLedgers.get(policy + ":" + token) ?? {}
  // policy/token come straight off the URL, and a token the indexer has never
  // seen has no meta -- and so no placeholder-glyph index either.
  const meta = store.tokenMeta[policy]?.[token]

  // An address that spent its whole balance keeps its key at zero, so drop
  // those: they are not holders, and they used to take places in the ten
  // shown below from addresses that are.
  const holders = Object.keys(tokData)
    .filter(addr => tokData[addr] > 0)
    .sort((a, b) => tokData[b] - tokData[a])

  const shown = holders.slice(0, 10)

  // The supply is read here rather than taken from the layout's header. The
  // layout load has no parameters and does not re-run on client-side
  // navigation, so its total is whatever was current when the page was last
  // loaded in full — on a chain minting every few seconds that disagrees with
  // this page's holders within moments, for no better reason than the two
  // numbers being read at different times.
  const supply = holders.reduce((sum, addr) => sum + tokData[addr], 0)

  return {
    logo: tokenLogo(policy, token, logo_lookup[(meta?.index ?? 0) % logo_lookup.length]),
    policy: policy,
    token: token,
    supply: formatAmount(supply, policy, token),
    holderCount: holders.length,
    // Say what is not being shown rather than truncating in silence.
    omitted: holders.length - shown.length,
    ledger: shown.map(addr => ({
      address: [addr, small_addr(addr)],
      amount: formatAmount(tokData[addr], policy, token),
      alias: store.alias(addr)
    }))
  }
}

export async function search(pattern) {
  const store = chainStore()
  if (pattern.includes("#")) {
    const utxoSplit = pattern.split("#")
    if (utxoSplit.length === 2 && store.outputs.has(pattern)) {
      return "/utxo/" + utxoSplit.join("/")
    }
  } else {
    if (store.blocks.has(pattern)) {
      return "/block/" + pattern
    }
    if (store.txs.has(pattern)) {
      return "/transaction/" + pattern
    }
    if (store.addresses.has(pattern)) {
      return "/address/" + pattern
    }
    if (/^[0-9]+$/.test(pattern) && store.byHeight.has(parseInt(pattern))) {
      return "/chain/" + pattern
    }
  }
  throw new Error("Not found: " + pattern)
}

export function renameAlias(addr, from, to) {
  try {
    chainStore().aliases.set(addr, to)
    fs.renameSync(GURU_ASSETS + "/addr/" + from + ".addr", GURU_ASSETS + "/addr/" + to + ".addr")
    fs.renameSync(GURU_ASSETS + "/keys/" + from + ".skey", GURU_ASSETS + "/keys/" + to + ".skey")
    fs.renameSync(GURU_ASSETS + "/keys/" + from + ".vkey", GURU_ASSETS + "/keys/" + to + ".vkey")
    fs.writeFileSync(GURU_ASSETS + "/alias/" + addr + ".alias", to)
  } catch (err) {}
}

export function loadBlocksPage(page) {
  const store = chainStore()
  const pageIndex = parseInt(page)
  const lastPage = store.latest === null ? 0 : store.latest.page
  const pageData = []
  for (let h = pageIndex * PAGE_LENGTH; h < (pageIndex + 1) * PAGE_LENGTH; h++) {
    const id = store.byHeight.get(h)
    if (id === undefined) break
    const block = store.blocks.get(id)
    pageData.push({
      height: block.height,
      id: small_hash(block.id),
      txCount: block.transactions.length
    })
  }
  return {
    pageIndex: pageIndex,
    lastPage: lastPage,
    pageData: pageData
  }
}

export function loadTransactionsPage(page) {
  const store = chainStore()
  const pageIndex = parseInt(page)
  const lastPage = Math.floor((store.txOrder.length - 1) / PAGE_LENGTH)
  const pageData = store.txOrder
    .slice(pageIndex * PAGE_LENGTH, (pageIndex + 1) * PAGE_LENGTH)
    .map(id => {
      const tx = store.txs.get(id)
      const spent = tx.outputs.map((o, i) => store.outputs.get(id + "#" + i).spentBy !== undefined)
      const unspentCount = spent.filter(s => !s).length
      return {
        index: tx.index,
        id: [id, small_hash(id)],
        unspentCount: unspentCount,
        spentCount: spent.length - unspentCount,
        utxos: spent
      }
    })
  return {
    pageIndex: pageIndex,
    lastPage: lastPage,
    pageData: pageData
  }
}
