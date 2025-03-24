import fs from 'fs'
import path from 'path'
import { OgmiosStateMachine } from './components/Ogmios.mjs'

const DB_ROOT=process.env.DEVNET_ROOT + "/runtime/index"
const OGMIOS_PORT = 1337

// Genesis constants - faucet initial utxo to seed all other tx's
const ADDR_FAUCET = "addr_test1vztc80na8320zymhjekl40yjsnxkcvhu58x59mc2fuwvgkc332vxv"
const GENESIS_FAUCET_HASH = "8c78893911a35d7c52104c98e8497a14d7295b4d9bf7811fc1d4e9f449884284"
const GENESIS_FAUCET_LOVELACE = 900000000000

const PAGE_LENGTH_BLOCKS = 25

function relative_link(target, frompath) {
  fs.symlinkSync(path.relative(path.dirname(frompath), target), frompath)
}

class DBTransformer {

  constructor() {
    this.tx_index = 1
  }

  transformBlock(ogmiosBlock) {
    return {
      id: ogmiosBlock.id,
      height: ogmiosBlock.height,
      slot: ogmiosBlock.slot,
      ancestor: ogmiosBlock.ancestor,
      transactions: ogmiosBlock.transactions.map(tx => {
        return tx.id
      })
    }
  }

  transformTransaction(ogmiosBlock, ogmiosTransaction) {
    //console.log(JSON.stringify(ogmiosTransaction, null, 2))
    const obj = {
      id: ogmiosTransaction.id,
      index: this.tx_index++,
      spends: ogmiosTransaction.spends,
      fee: ogmiosTransaction.fee,
      validityInterval: ogmiosTransaction.validityInterval,
      signatories: ogmiosTransaction.signatories,
      producedHeight: ogmiosBlock.height,
      inputs: ogmiosTransaction.inputs.map(i => {
        return i.transaction.id + "#" + i.index
      }),
      outputs: ogmiosTransaction.outputs.map(o => {
        return o.address
      }),
    }
    if (ogmiosTransaction.scripts !== undefined) {
      obj.scripts = Object.keys(ogmiosTransaction.scripts).map(cred => {
        return {
          cred: cred,
          cbor: ogmiosTransaction.scripts[cred].cbor
        }
      })
    }
    return obj
  }

}

class DBWriter {

  constructor(db, transformer) {
    this.db = db
    this.transformer = transformer
    this.token_index = 1
    try {
      fs.rmSync(this.db, {
        recursive: true
      })
    } catch (alreadyExists) {}
    fs.mkdirSync(this.db)
    fs.mkdirSync(this.db + "/blocks")
    fs.mkdirSync(this.db + "/chain")
    fs.mkdirSync(this.db + "/transactions")
    fs.mkdirSync(this.db + "/addresses")
    fs.mkdirSync(this.db + "/tokens")

    // 
    fs.mkdirSync(this.db + "/pages")
    fs.mkdirSync(this.db + "/pages/blocks")
    fs.mkdirSync(this.db + "/pages/transactions")

    // Populate initial faucet utxo (genesis), hardcoded because the hash will
    // never change
    const genesis_tx_path = this.db + "/transactions/" + GENESIS_FAUCET_HASH
    fs.mkdirSync(genesis_tx_path + "/outputs/0", { recursive: true })
    fs.writeFileSync(genesis_tx_path + "/tx", JSON.stringify({
      id: GENESIS_FAUCET_HASH,
      index: 0,
      producedHeight: 0,
      fee: {
        ada: {
          lovelace: 0
        }
      },
      outputs: [
        ADDR_FAUCET
      ]
    }, null, 2))
    fs.writeFileSync(genesis_tx_path + "/outputs/0/output", JSON.stringify({
      address: ADDR_FAUCET,
      value: {
        ada: {
          lovelace: GENESIS_FAUCET_LOVELACE
        }
      }
    }, null, 2))
    const genesis_address_path = this.db + "/addresses/" + ADDR_FAUCET
    fs.mkdirSync(genesis_address_path)
    // create initial ledger
    fs.writeFileSync(genesis_address_path + "/ledger", JSON.stringify({
      ada: {
        lovelace: GENESIS_FAUCET_LOVELACE
      }
    }, null, 2))
    fs.writeFileSync(genesis_address_path + "/unspent", JSON.stringify([
      GENESIS_FAUCET_HASH + "#0"
    ], null, 2))
    fs.writeFileSync(genesis_address_path + "/alias", "faucet")
    fs.mkdirSync(this.db + "/tokens/ada/lovelace", { recursive: true })
    const adaLedger = {}
    adaLedger[ADDR_FAUCET] = GENESIS_FAUCET_LOVELACE
    fs.writeFileSync(this.db + "/tokens/ada/lovelace/ledger", JSON.stringify(adaLedger, null, 2))
    fs.writeFileSync(this.db + "/tokens/ledger", JSON.stringify({
      ada: {
        lovelace: {
          index: 0,
          amount: GENESIS_FAUCET_LOVELACE
        }
      }
    }, null, 2))

    // Write pages
    const txObj = {
      list: [],
      ids: {}
    }
    txObj.list.push(GENESIS_FAUCET_HASH)
    txObj.ids[GENESIS_FAUCET_HASH] = {
      index: 0,
      unspentCount: 1,
      spent: [ false ]
    }
    fs.writeFileSync(this.db + "/pages/transactions/0", JSON.stringify(txObj, null, 2))
  }

  writeBlock(block) {
    const dbBlock = this.transformer.transformBlock(block)
    dbBlock.page = Math.floor(dbBlock.height / PAGE_LENGTH_BLOCKS)
    console.log(`Latest block: height[${dbBlock.height}] id[${dbBlock.id}]`)
    const formattedBlock = JSON.stringify(dbBlock, null, 2)
    fs.mkdirSync(this.db + "/blocks/" + dbBlock.id)
    if (block.transactions.length > 0) {
      fs.mkdirSync(this.db + "/blocks/" + dbBlock.id + "/transactions")
    }
    fs.writeFileSync(this.db + "/blocks/" + dbBlock.id + "/block", formattedBlock)
    relative_link(this.db + "/blocks/" + dbBlock.id, this.db + "/chain/" + dbBlock.height)
    block.transactions.forEach((tx, index) => {
      this.writeTransaction(block, tx)
      relative_link(this.db + "/transactions/" + tx.id, this.db + "/blocks/" + block.id + "/transactions/" + index)
    })
    // Write over file, do not remove, to allow file watching
    fs.writeFileSync(this.db + "/latest", formattedBlock)

    // Update pages
    let pageObj = []
    try {
      pageObj = JSON.parse(fs.readFileSync(this.db + "/pages/blocks/" + dbBlock.page))
    } catch (noSuchFile) {}
    pageObj.push({
      height: dbBlock.height,
      id: dbBlock.id,
      txCount: block.transactions.length
    })
    fs.writeFileSync(this.db + "/pages/blocks/" + dbBlock.page, JSON.stringify(pageObj, null, 2))
    fs.writeFileSync(this.db + "/pages/blocks/last", JSON.stringify(dbBlock.page))
  }

  writeTransaction(block, tx) {
    const dbTx = this.transformer.transformTransaction(block, tx)
    const formattedTransaction = JSON.stringify(dbTx, null, 2)
    fs.mkdirSync(this.db + "/transactions/" + tx.id)
    fs.mkdirSync(this.db + "/transactions/" + tx.id + "/inputs")
    fs.mkdirSync(this.db + "/transactions/" + tx.id + "/outputs")
    relative_link(this.db + "/blocks/" + block.id + "/block", this.db + "/transactions/" + tx.id + "/block")
    let redeemers = {}
    if (tx.redeemers !== undefined) {
      redeemers = Object.keys(tx.redeemers).reduce((acc, r) => {
        const [type, indx] = r.split(":")
        acc[indx] = {
          type: type,
          data: tx.redeemers[r].redeemer
        }
        return acc
      }, {})
    }
    tx.inputs.forEach((input, index) => {
      fs.mkdirSync(this.db + "/transactions/" + tx.id + "/inputs/" + index)
      relative_link(this.db + "/transactions/" + input.transaction.id + "/outputs/" + input.index + "/output", this.db + "/transactions/" + tx.id + "/inputs/" + index + "/input")
      relative_link(this.db + "/transactions/" + tx.id, this.db + "/transactions/" + input.transaction.id + "/outputs/" + input.index + "/spentBy")
      const inputUtxoFile = this.db + "/transactions/" + input.transaction.id + "/outputs/" + input.index + "/output"
      const inputUtxo = JSON.parse(fs.readFileSync(inputUtxoFile))
      this.consume(inputUtxo)
      if (redeemers[index] !== undefined) {
        inputUtxo.redeemer = redeemers[index]
      }

      // Add to address history
      let history
      try {
        history = JSON.parse(fs.readFileSync(this.db + "/addresses/" + inputUtxo.address + "/history"))
      } catch (fileNotFound) {
        history = []
      }
      if (history.length === 0 || history[history.length-1].id !== tx.id) {
        history.push({
          block: block.height,
          id: tx.id
        })
      }
      fs.writeFileSync(this.db + "/addresses/" + inputUtxo.address + "/history", JSON.stringify(history, null, 2))
      const unspent = JSON.parse(fs.readFileSync(this.db + "/addresses/" + inputUtxo.address + "/unspent"))
      fs.writeFileSync(this.db + "/addresses/" + inputUtxo.address + "/unspent", JSON.stringify(
        unspent.filter(unsp => {
          if (unsp === input.transaction.id + "#" + input.index) {
            return false
          }
          return true
        })
      ), null, 2)

      // update output status
      inputUtxo.spentBy = tx.id
      inputUtxo.spentHeight = block.height
      fs.writeFileSync(inputUtxoFile, JSON.stringify(inputUtxo, null, 2))

      // update page
      const inTx = JSON.parse(fs.readFileSync(this.db + "/transactions/" + input.transaction.id + "/tx"))
      const txpage = Math.floor(inTx.index / PAGE_LENGTH_BLOCKS)
      const txPageFile = this.db + "/pages/transactions/" + txpage
      const txPageObj = JSON.parse(fs.readFileSync(txPageFile))
      txPageObj.ids[input.transaction.id].spent[input.index] = true
      txPageObj.ids[input.transaction.id].unspentCount--
      fs.writeFileSync(txPageFile, JSON.stringify(txPageObj, null, 2))
    })
    tx.outputs.forEach((output, index) => {
      fs.mkdirSync(this.db + "/transactions/" + tx.id + "/outputs/" + index)
      fs.writeFileSync(this.db + "/transactions/" + tx.id + "/outputs/" + index + "/output", JSON.stringify(output, null, 2))
      let unspent = []
      try {
        fs.mkdirSync(this.db + "/addresses/" + output.address)
      } catch (alreadyExists) {}
      try {
        unspent = JSON.parse(fs.readFileSync(this.db + "/addresses/" + output.address + "/unspent"))
      } catch (fileNotFound) {}
      this.produce(output)
      unspent.push(tx.id + "#" + index)
      fs.writeFileSync(this.db + "/addresses/" + output.address + "/unspent", JSON.stringify(unspent, null, 2))
    })
    
    // Update pages
    const page = Math.floor(dbTx.index / PAGE_LENGTH_BLOCKS)
    let pageObj = { list: [], ids: {} }
    try {
      pageObj = JSON.parse(fs.readFileSync(this.db + "/pages/transactions/" + page))
    } catch (noSuchFile) {}
    pageObj.list.push(dbTx.id)
    pageObj.ids[dbTx.id] = {
      index: dbTx.index,
      unspentCount: tx.outputs.length,
      spent: tx.outputs.map(() => { return false })
    }
    fs.writeFileSync(this.db + "/pages/transactions/" + page, JSON.stringify(pageObj, null, 2))
    fs.writeFileSync(this.db + "/pages/transactions/last", JSON.stringify(page))
    // Do this last because the provider waits for this file to eliminate race conditions
    fs.writeFileSync(this.db + "/transactions/" + tx.id + "/tx", formattedTransaction)
  }

  produce(utxo) {
    let balances = {}
    try {
      balances = JSON.parse(fs.readFileSync(this.db + "/addresses/" + utxo.address + "/ledger"))
    } catch (fileNotFound) {}
    const metadata = JSON.parse(fs.readFileSync(this.db + "/tokens/ledger"))
    Object.keys(utxo.value).forEach(pid => {
      const tokenPidDir = this.db + "/tokens/" + pid
      if (!fs.existsSync(tokenPidDir)) {
        fs.mkdirSync(tokenPidDir)
      }
      Object.keys(utxo.value[pid]).forEach(tn => {
        const tokenDir = tokenPidDir + "/" + tn
        if (!fs.existsSync(tokenDir)) {
          fs.mkdirSync(tokenDir)
        }
        let tokenLedger = {}
        try {
          tokenLedger = JSON.parse(fs.readFileSync(tokenDir + "/ledger"))
        } catch {}
        if (balances[pid] === undefined) balances[pid] = {}
        if (balances[pid][tn] === undefined) balances[pid][tn] = 0
        balances[pid][tn] += utxo.value[pid][tn]
        if (metadata[pid] === undefined) metadata[pid] = {}
        if (metadata[pid][tn] === undefined) {
          metadata[pid][tn] = {
            index: this.token_index++,
            amount: 0
          }
        }
        metadata[pid][tn].amount += utxo.value[pid][tn]
        if (tokenLedger[utxo.address] === undefined) tokenLedger[utxo.address] = 0
        tokenLedger[utxo.address] += utxo.value[pid][tn]
        fs.writeFileSync(tokenDir + "/ledger", JSON.stringify(tokenLedger, null, 2))
      })
    })
    fs.writeFileSync(this.db + "/addresses/" + utxo.address + "/ledger", JSON.stringify(balances, null, 2))
    fs.writeFileSync(this.db + "/tokens/ledger", JSON.stringify(metadata, null, 2))
    const aliasFile = process.env.CARDANO_CLI_GURU + "/assets/alias/" + utxo.address + ".alias"
    if (fs.existsSync(aliasFile)) {
      fs.copyFileSync(aliasFile, this.db + "/addresses/" + utxo.address + "/alias")
    }
  }
  
  consume(utxo) {
    const balances = JSON.parse(fs.readFileSync(this.db + "/addresses/" + utxo.address + "/ledger"))
    const metadata = JSON.parse(fs.readFileSync(this.db + "/tokens/ledger"))
    Object.keys(utxo.value).forEach(pid => {
      Object.keys(utxo.value[pid]).forEach(tn => {
        const tokenDir = this.db + "/tokens/" + pid + "/" + tn
        const tokenLedger = JSON.parse(fs.readFileSync(tokenDir + "/ledger"))
        if (balances[pid] === undefined) balances[pid] = {}
        if (balances[pid][tn] === undefined) balances[pid][tn] = 0
        balances[pid][tn] -= utxo.value[pid][tn]
        metadata[pid][tn].amount -= utxo.value[pid][tn]
        tokenLedger[utxo.address] -= utxo.value[pid][tn]
        fs.writeFileSync(tokenDir + "/ledger", JSON.stringify(tokenLedger, null, 2))
      })
    })
    fs.writeFileSync(this.db + "/addresses/" + utxo.address + "/ledger", JSON.stringify(balances, null, 2))
    fs.writeFileSync(this.db + "/tokens/ledger", JSON.stringify(metadata, null, 2))
  }

}

const writer = new DBWriter(DB_ROOT, new DBTransformer())
const osm = new OgmiosStateMachine(OGMIOS_PORT)
osm.on('block', writer.writeBlock.bind(writer))

