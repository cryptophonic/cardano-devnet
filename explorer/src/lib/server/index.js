import fs from 'fs'

const DB=process.env.DEVNET_ROOT + "/runtime/index"
const GURU_ASSETS=process.env.CARDANO_CLI_GURU + "/assets"

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

function addr_alias(addr) {
  const aliasFile = DB + "/addresses/" + addr + "/alias"
  let alias
  try {
    alias = fs.readFileSync(aliasFile).toString().trim()
  } catch (notFound) {
  }
  return alias
}

function formatADA(lovelace) {
  let ada = ("" + lovelace).slice(0,-6)
  if (ada === "") ada = "0"
  return ada + "." + ("000000" + lovelace).slice(-6)
}

export function loadBlock(path) {
  const block = JSON.parse(fs.readFileSync(DB + path))
  const latest = JSON.parse(fs.readFileSync(DB + "/latest"))
  const txs = block.transactions.map(t => {
    const tobj = JSON.parse(fs.readFileSync(DB + "/transactions/" + t + "/tx"))
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
    latest: latest.height,
    txs: txs
  }
}

export function loadLatest() {
  // Local devnet mode may never have run on this host at all -- a fork-only
  // session has no reason to have started it -- and this load() runs for
  // every route via +layout.server.js, including the fork-mode pages below,
  // which don't touch the indexer. Degrade to an empty devnet rather than
  // taking the whole app down for routes that don't need this.
  if (!fs.existsSync(DB + "/latest")) return { height: 0, tokens: {} }
  const latest = JSON.parse(fs.readFileSync(DB + "/latest"))
  const tokens = JSON.parse(fs.readFileSync(DB + "/tokens/ledger"))
  //console.log("Loading latest: " + latest.height)
  latest.tokens = Object.keys(tokens).reduce((acc, kpolicy) => {
    Object.keys(tokens[kpolicy]).map(ktoken => {
      let logo
      let amount
      logo = logo_lookup[tokens[kpolicy][ktoken].index]
      if (kpolicy === "ada" && ktoken == "lovelace") {
        amount = formatADA(tokens[kpolicy][ktoken].amount)
      } else {
        amount = tokens[kpolicy][ktoken].amount
      }
      acc[small_hash(kpolicy) + ":" + ktoken] = {
        logo: logo,
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
  return await new Promise(resolve => {
    const listener = () => {
      resolve(loadLatest())
      fs.unwatchFile(DB + "/latest", listener)
    }
    fs.watchFile(DB + "/latest", { interval: 507 }, listener)
  })
}

export function loadTransaction(hash) {
  const tx = JSON.parse(fs.readFileSync(DB + "/transactions/" + hash + "/tx"))
  try {
    tx.hash = [tx.id, small_hash(tx.id)]
    const block = JSON.parse(fs.readFileSync(DB + "/transactions/" + hash + "/block"))
    tx.block = [block.id, small_hash(block.id)]
    tx.blockHeight = block.height
  } catch (noSuchFile) {
    tx.block = ["genesis", "genesis"]
    tx.blockHeight = 0
  }
  if (tx.inputs !== undefined) {
    tx.inputs = tx.inputs.map(input => {
      const [ intx, index ] = input.split("#")
      const intxfile = DB + "/transactions/" + intx + "/outputs/" + index + "/output"
      const val = JSON.parse(fs.readFileSync(intxfile))
      const obj = {
        hash: [intx, small_hash(intx)],
        ref: index,
        addr: [val.address, small_addr(val.address)],
        alias: addr_alias(val.address),
        value: Object.keys(val.value).reduce((acc, kpolicy) => {
          Object.keys(val.value[kpolicy]).map(ktoken => {
            acc[kpolicy + ":" + ktoken] = val.value[kpolicy][ktoken]
          })
          return acc
        }, {})
      }
      obj.tokenCount = Object.keys(obj.value).length - 1
      obj.value["ada"] = formatADA(obj.value["ada:lovelace"])
      return obj
    })
  } else {
    tx.inputs = []
  }
  tx.outputs = tx.outputs.map((output, index) => {
    const outtxfile = DB + "/transactions/" + tx.id + "/outputs/" + index + "/output"
    const val = JSON.parse(fs.readFileSync(outtxfile))
    const obj = {
      addr: [output, small_addr(output)],
      alias: addr_alias(output),
      ref: index,
      value: Object.keys(val.value).reduce((acc, kpolicy) => {
        Object.keys(val.value[kpolicy]).map(ktoken => {
          acc[kpolicy + ":" + ktoken] = val.value[kpolicy][ktoken]
        })
        return acc
      }, {}),
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
  const txData = JSON.parse(fs.readFileSync(DB + "/transactions/" + hash + "/tx"))
  const utxoData = JSON.parse(fs.readFileSync(DB + "/transactions/" + hash + "/outputs/" + ref + "/output"))
  const metadata = JSON.parse(fs.readFileSync(DB + "/tokens/ledger"))
  const utxo = {
    hash: [hash, small_hash(hash)],
    ref: ref,
    addr: [utxoData.address, small_addr(utxoData.address)],
    alias: addr_alias(utxoData.address),
    datum: utxoData.datum,
    redeemer: utxoData.redeemer,
    value: Object.keys(utxoData.value).reduce((acc, kpolicy) => {
      Object.keys(utxoData.value[kpolicy]).map(ktoken => {
        const logo = logo_lookup[metadata[kpolicy][ktoken].index]
        acc[kpolicy + ":" + ktoken] = {
          policy: [kpolicy, small_hash(kpolicy)],
          token: ktoken,
          logo: logo,
          amount: utxoData.value[kpolicy][ktoken]
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
  const alias = addr_alias(addr)
  let ledgerValues = []
  try {
    ledgerValues = JSON.parse(fs.readFileSync(DB + "/addresses/" + addr + "/ledger"))
  } catch (fileNotFound) {}
  const metadata = JSON.parse(fs.readFileSync(DB + "/tokens/ledger"))
  const ledger = Object.keys(ledgerValues).reduce((acc, kpolicy) => {
    Object.keys(ledgerValues[kpolicy]).map(ktoken => {
      const logo = logo_lookup[metadata[kpolicy][ktoken].index]
      acc[kpolicy + ":" + ktoken] = {
        policy: [kpolicy, small_hash(kpolicy)],
        token: ktoken,
        logo: logo,
        amount: ledgerValues[kpolicy][ktoken]
      }
    })
    return acc
  }, {})
  let history = []
  try {
    history = JSON.parse(fs.readFileSync(DB + "/addresses/" + addr + "/history"))
  } catch (fileNotFound) {} 
  let unspent = []
  try {
    unspent = JSON.parse(fs.readFileSync(DB + "/addresses/" + addr + "/unspent"))
  } catch (fileNotFound) {}
  const obj = {
    address: [addr, small_addr(addr)],
    alias: alias,
    ledger: ledger,
    history: history.map(h => {
      return {
        block: h.block,
        id: [h.id, small_hash(h.id)]
      }
    }),
    unspent: unspent.map(u => {
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
  const tokData = JSON.parse(fs.readFileSync(DB + "/tokens/" + policy + "/" + token + "/ledger"))
  const metadata = JSON.parse(fs.readFileSync(DB + "/tokens/ledger"))
  let count = 0
  const pagedData = Object.keys(tokData).reduce((acc, addr) => {
    let amt = tokData[addr]
    if (policy === "ada" && token === "lovelace") amt = formatADA(amt)
    if (count < 10) {
      const alias = addr_alias(addr)
      acc.push({
        address: [addr, small_addr(addr)],
        amount: amt,
        alias: alias
      })
      count++
    }
    return acc
  }, [])
  return {
    logo: logo_lookup[metadata[policy][token].index],
    policy: policy,
    token: token,
    ledger: pagedData
  }
}

const testPath = async path => {
  return new Promise(res => {
    try {
      fs.statSync(path)
      res(true)
    } catch (fileNotFoundErr) {
      res(false)
    }
  })
}

export async function search(pattern) {
  if (pattern.includes("#")) {
    const utxoSplit = pattern.split("#")
    if (utxoSplit.length === 2 && await testPath(DB + "/transactions/" + utxoSplit[0] + "/outputs/" + utxoSplit[1])) {
      console.log("found utxo")
      return "/utxo/" + utxoSplit.join("/")
    }
  } else {
    if (await testPath(DB + "/blocks/" + pattern)) {
      console.log("found block")
      return "/block/" + pattern
    }
    if (await testPath(DB + "/transactions/" + pattern)) {
      console.log("found transaction")
      return "/transaction/" + pattern
    }
    if (await testPath(DB + "/addresses/" + pattern)) {
      console.log("found address")
      return "/address/" + pattern
    }
    if (await testPath(DB + "/chain/" + pattern)) {
      console.log("found height")
      return "/chain/" + pattern
    }
  }
  throw new Error("Not found: " + pattern)
}

export function renameAlias(addr, from, to) {
  try {
    fs.writeFileSync(DB + "/addresses/" + addr + "/alias", to)
    fs.renameSync(GURU_ASSETS + "/addr/" + from + ".addr", GURU_ASSETS + "/addr/" + to + ".addr")
    fs.renameSync(GURU_ASSETS + "/keys/" + from + ".skey", GURU_ASSETS + "/keys/" + to + ".skey")
    fs.renameSync(GURU_ASSETS + "/keys/" + from + ".vkey", GURU_ASSETS + "/keys/" + to + ".vkey")
    fs.writeFileSync(GURU_ASSETS + "/alias/" + addr + ".alias", to)
  } catch (err) {}
}

export function loadBlocksPage(page) {
  const pg = JSON.parse(fs.readFileSync(DB + "/pages/blocks/" + page))
  const last = JSON.parse(fs.readFileSync(DB + "/pages/blocks/last"))
  const newObj = {
    pageIndex: parseInt(page),
    lastPage: parseInt(last),
    pageData: pg.map(p => {
      return {
        height: p.height,
        id: small_hash(p.id),
        txCount: p.txCount
      }
    })
  }
  return newObj
}

export function loadTransactionsPage(page) {
  const pg = JSON.parse(fs.readFileSync(DB + "/pages/transactions/" + page))
  const last = JSON.parse(fs.readFileSync(DB + "/pages/transactions/last"))
  const newObj = {
    pageIndex: parseInt(page),
    lastPage: parseInt(last),
    pageData: pg.list.map(p => {
      return {
        index: pg.ids[p].index,
        id: [p, small_hash(p)],
        unspentCount: pg.ids[p].unspentCount,
        spentCount: pg.ids[p].spent.length - pg.ids[p].unspentCount,
        utxos: pg.ids[p].spent
      }
    })
  }
  return newObj
}
