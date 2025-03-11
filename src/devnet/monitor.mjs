import fs from 'fs'
import bunyan from 'bunyan'
import blessed from 'blessed'
import { OgmiosStateMachine } from './components/Ogmios.mjs'

// Output logging
const log = bunyan.createLogger({
  name: 'myapp',
  streams: [
    {
      level: 'info',
      path: process.env.DEVNET_ROOT + '/cardano-devnet.log'
    }
  ]
})

const OGMIOS_PORT = 1337

let currentBlockHash = ""
let currentSlot = 0

// Load address lookups
const addressLookup = {} // address lookup by name
const nameLookup = {} // name lookup by address
const ALIASES = process.env.CARDANO_CLI_GURU + "/assets/alias"

const indexedTransactions = {}

// Terminal output
const screen = blessed.screen({
  smartCSR: true
})

const box = blessed.box({
  top: 'center',
  left: 'center',
  width: '100%',
  height: '100%',
  content: '  Blockchain Status',
  tags: true,
  border: {
    type: 'line'
  },
  style: {
    fg: 'white',
    bg: 'gray'
  }
})
const blockHeight = blessed.text({
  top: 2,
  left: 1,
  width: '100%',
  height: 1,
  tags: true,
  content: " Block height:",
  style: {
    bg: 'gray'
  }
})
const blockHash = blessed.text({
  top: 3,
  left: 1,
  width: 73,
  height: 1,
  content: " Hash:",
  style: {
    bg: 'gray'
  }
})
const latestTransaction = blessed.text({
  top: 5,
  left: 1,
  width: '100%-4',
  height: 1,
  tags: true,
  content: " Latest Tx:"
})
const latestUtxoList = blessed.text({
  top: 7,
  left: 10,
  width: '90%',
  height: 0,
  tags: true,
  style: {
    bg: 'gray'
  }
})
const mempoolTransactions = blessed.text({
  top: 8,
  left: 1,
  width: '100%-4',
  height: 1,
  content: " Mempool:"
})
const mempoolTxList = blessed.text({
  top: 10,
  left: 10,
  width: '90%',
  height: 0,
  tags: true,
  style: {
    bg: 'gray'
  }
})
box.append(blockHeight)
box.append(blockHash)
box.append(latestTransaction)
box.append(latestUtxoList)
box.append(mempoolTransactions)
box.append(mempoolTxList)

screen.append(box)
box.focus()

screen.key(['q', 'C-c'], (ch, key) => {
  return process.exit()
})

screen.render()

const colorTx = str => {
  return "{yellow-fg}" + str + "{/}"
}

const colorUtxo = str => {
  return "{red-fg}" + str + "{/}"
}

const colorAddr = str => {
  return "{blue-fg}" + str + "{/}"
}

const colorValue = str => {
  return "{green-fg}" + str + "{/}"
}

const formatTx = tx => {
  let str = ""
  let height = 0
  // Lines with both an input and output
  for (var i = 0; i < tx.inputs.length; i++) {
    const input = tx.inputs[i]
    const key = input.transaction.id + "#" + input.index
    if (indexedTransactions[key] !== undefined) {
      const [n, v] = indexedTransactions[key]
      const lStr = "#" + input.index + ": " + n
      const vStr = "  ₳ " + v
      str += lStr + " ".repeat(64 - lStr.length - vStr.length) + colorValue(vStr)
      delete indexedTransactions[key]
    } else {
      str += " ".repeat(64)
      //str += "unindexed utxo (genesis?)" + " ".repeat(39)
    }
    if (tx.outputs[i] !== undefined) {
      const output = tx.outputs[i]
      let line = "#" + i + ": "
      if (nameLookup[output.address] !== undefined) {
        line += nameLookup[output.address]
      }
      log.info("line=" + line)
      const value = output.value.ada.lovelace / 1000000.0
      const vStr = "₳ " + value.toFixed(6)
      log.info("value=" + value)
      str += " ".repeat(70 - key.length) + " -->    " + line
      log.info(JSON.stringify(output))
      log.info("address: " + output.address.length)
      log.info("line: " + line.length)
      log.info("vstr: " + vStr.length)
      str += " ".repeat(output.address.length - line.length - vStr.length)
      str += colorValue(vStr)
    }
    str += "\n"
    height += 1
    str += colorUtxo(input.transaction.id) + " ".repeat(78 - key.length)
    if (tx.outputs[i] !== undefined) {
      const output = tx.outputs[i]
      str += colorAddr(output.address)
    }
    str += "\n\n"
    height += 2
  }
  // Lines with just an output
  for (var i = tx.inputs.length; i < tx.outputs.length; i++) {
    const output = tx.outputs[i]
    let line = "#" + i + ": "
    if (nameLookup[output.address] !== undefined) {
      line += nameLookup[output.address]
    }
    const value = output.value.ada.lovelace / 1000000.0
    const vStr = "₳ " + value.toFixed(6)
    str += " ".repeat(76) + line + " ".repeat(output.address.length - line.length - vStr.length)
    str += colorValue(vStr) + "\n"
    str += " ".repeat(76) + colorAddr(output.address) + "\n"
    height += 2
  }
  return [str, height]
}

class ChainEventHandler {

  constructor() {
    this.state_machine = new OgmiosStateMachine(OGMIOS_PORT)
    this.state_machine.on('block', this.newBlock.bind(this))
    this.state_machine.on('mempoolStart', this.poolStart.bind(this))
    this.state_machine.on('mempoolStop', this.poolStop.bind(this))
    this.state_machine.on('transaction', this.newTransaction.bind(this))
  }

  checkAlias(addr) {
    if (nameLookup[addr] === undefined) {
      // Check for an alias for this address
      const alias_path = ALIASES + "/" + addr + ".alias"
      if (fs.existsSync(alias_path)) {
        const alias = fs.readFileSync(alias_path)
        addressLookup[alias] = addr
        log.info("adding alias for " + addr + ": " + alias)
        nameLookup[addr] = alias
      }
    }
  }

  newBlock(block) {
    currentBlockHash = block.id
    currentSlot = block.slot
    const density = 100.0 * block.height / block.slot
    blockHeight.content = " Block height: " + block.height + " slot: " + block.slot + " chain density: " + density.toFixed(2) + "%"
    blockHash.content = " Hash: " + block.id
    block.transactions.forEach(tx => {
      tx.outputs.forEach((output, index) => {
        const value = output.value.ada.lovelace / 1000000.0
        this.checkAlias(output.address)
        if (nameLookup[output.address] !== undefined) {
          indexedTransactions[tx.id + "#" + index] = [nameLookup[output.address], value]
        }
      })
    })
    if (block.transactions.length > 0) {
      // Last tx
      const lastTx = block.transactions[block.transactions.length - 1]
      const fee = lastTx.fee.ada.lovelace / 1000000.0
      latestTransaction.content = " Latest Tx: " + colorTx(lastTx.id) + "  Fee: ₳ " + fee.toFixed(6)

      const [text, height] = formatTx(lastTx)
      latestUtxoList.content = text
      latestUtxoList.height = height

      mempoolTransactions.top = 8 + height
      mempoolTxList.top = 10 + height
    }
    screen.render()
  }

  poolStart() {
    mempoolTxList.newContent = ""
    mempoolTxList.newHeight = 0
    screen.render()
  }

  poolStop() {
    if (mempoolTxList.content !== mempoolTxList.newContent) {
      mempoolTxList.content = mempoolTxList.newContent
      mempoolTxList.height = mempoolTxList.newHeight
      screen.render()
    }
  }

  newTransaction(tx) {
    let str = ""
    let h = 0
    for (var i = 0; i < tx.inputs.length; i++) {
      str += "    " + colorUtxo(tx.inputs[i].transaction.id + "#" + tx.inputs[i].index)
      if (i === 0) str += "   -->   "
      else str += "         "
      if (i < tx.outputs.length) {
        const value = tx.outputs[i].value.ada.lovelace / 1000000.0
        this.checkAlias(tx.outputs[i].address)
        const vStr = "₳ " + value.toFixed(6)
        str += colorAddr(tx.outputs[i].address) + "  " + colorValue(vStr)
      }
      str += "\n"
      h++
    }
    for (var i = tx.inputs.length; i < tx.outputs.length; i++) {
      const value = tx.outputs[i].value.ada.lovelace / 1000000.0
      this.checkAlias(tx.outputs[i].address)
      const vStr = "₳ " + value.toFixed(6)
      str += " ".repeat(79) + colorAddr(tx.outputs[i].address) + "  " + colorValue(vStr) + "\n"
      h++
    }
    mempoolTxList.newContent += "Tx: " + colorTx(tx.id) + "\n" + str + "\n"
    mempoolTxList.newHeight += h + 2
  }

}

new ChainEventHandler()
