// A Blaze provider for a fork run.
//
// This is Kupmios with the Kupo half removed: every method the upstream class
// answers out of Kupo is overridden here to ask the fork's own ogmios instead,
// so a fork needs no indexer at all. The rest -- protocol parameters, tx
// evaluation, submission -- is inherited, because those already go to ogmios.
//
// Why not src/devnet/provider.mjs: that one fronts ogmios on a fixed localhost
// port and serves UTxOs out of runtime/index, the JSON indexer's filesystem
// tree. A fork has neither (the indexer is off for network forks -- indexing
// preview from origin is not the job), and its ogmios is reachable only on the
// devnet-forks bridge. See scripts/devnet-fork ogmios.

import {
  Address,
  AssetId,
  Datum,
  DatumHash,
  HexBlob,
  NativeScript,
  PlutusData,
  PlutusV1Script,
  PlutusV2Script,
  PlutusV3Script,
  Script,
  TransactionId,
  TransactionInput,
  TransactionOutput,
  TransactionUnspentOutput,
  Value
} from '@blaze-cardano/core'

import { Kupmios } from '@blaze-cardano/query'

import { LosslessOgmios } from './ogmios.mjs'

// Anything still reaching for Kupo is a bug, and a URL that cannot resolve says
// so at the point of use rather than hanging.
const NO_KUPO = 'http://kupo.invalid'

/**
 * @typedef {object} OgmiosUtxo
 * @property {{ id: string }} transaction
 * @property {number} index
 * @property {string} address
 * @property {Record<string, Record<string, number|string>>} value
 *   quantities past Number.MAX_SAFE_INTEGER arrive as strings; see ogmios.mjs
 * @property {string} [datumHash]
 * @property {string} [datum]
 * @property {{ language: string, cbor: string }} [script]
 */

export class ForkProvider extends Kupmios {

  /**
   * @param {LosslessOgmios} ogmios a connected client for this fork's sidecar
   */
  constructor(ogmios) {
    // Kupmios calls exactly four methods on its ogmios client, and LosslessOgmios
    // provides all four, so the inherited protocol-parameter, evaluation and
    // submission paths work unchanged -- while every quantity that comes back is
    // read exactly. See ogmios.mjs for what "exactly" is worth here.
    super(NO_KUPO, ogmios)
  }

  /**
   * @param {string} url ws:// address of a fork's ogmios sidecar
   * @returns {Promise<ForkProvider>}
   */
  static async connect(url) {
    return new ForkProvider(await LosslessOgmios.connect(url))
  }

  async close() {
    await this.ogmios.kill()
  }

  // ------------------------------------------------------------ chain state

  /** @returns {Promise<{ slot: number, id: string }>} */
  async tip() {
    return this.ogmios.queryNetworkTip()
  }

  /** @returns {Promise<number>} */
  async epoch() {
    return this.ogmios.queryLedgerStateEpoch()
  }

  /** @returns {Promise<number>} */
  async blockHeight() {
    return this.ogmios.queryNetworkBlockHeight()
  }

  // ------------------------------------------------------------ utxo queries

  /**
   * Ogmios' utxo shape -> blaze's. Everything needed is in the reply, including
   * inline datums and script refs, so unlike the Kupo path this resolves no
   * hashes and makes no second round trip.
   * @param {OgmiosUtxo} utxo
   * @returns {TransactionUnspentOutput}
   */
  static toUnspentOutput(utxo) {
    const tokens = new Map()
    let lovelace = 0n
    // BigInt(), not Number(): a quantity past 2^53 arrives as a string
    for (const [policy, entries] of Object.entries(utxo.value)) {
      if (policy === 'ada') {
        lovelace = BigInt(entries.lovelace)
      } else {
        for (const [name, quantity] of Object.entries(entries)) {
          tokens.set(AssetId.fromParts(policy, name), BigInt(quantity))
        }
      }
    }
    const output = new TransactionOutput(
      Address.fromBech32(utxo.address),
      new Value(lovelace, tokens)
    )
    if (utxo.datum !== undefined) {
      output.setDatum(Datum.newInlineData(PlutusData.fromCbor(HexBlob(utxo.datum))))
    } else if (utxo.datumHash !== undefined) {
      output.setDatum(Datum.newDataHash(DatumHash(utxo.datumHash)))
    }
    if (utxo.script !== undefined) {
      output.setScriptRef(ForkProvider.toScript(utxo.script))
    }
    return new TransactionUnspentOutput(
      new TransactionInput(TransactionId(utxo.transaction.id), BigInt(utxo.index)),
      output
    )
  }

  /**
   * @param {{ language: string, cbor: string }} script
   * @returns {Script}
   */
  static toScript(script) {
    switch (script.language) {
      case 'native': return Script.newNativeScript(NativeScript.fromCbor(HexBlob(script.cbor)))
      case 'plutus:v1': return Script.newPlutusV1Script(new PlutusV1Script(HexBlob(script.cbor)))
      case 'plutus:v2': return Script.newPlutusV2Script(new PlutusV2Script(HexBlob(script.cbor)))
      case 'plutus:v3': return Script.newPlutusV3Script(new PlutusV3Script(HexBlob(script.cbor)))
      default: throw new Error('unsupported script language: ' + script.language)
    }
  }

  /**
   * @param {Address} address
   * @returns {Promise<TransactionUnspentOutput[]>}
   */
  async getUnspentOutputs(address) {
    const utxos = await this.ogmios.queryLedgerStateUtxo({ addresses: [address.toBech32()] })
    return utxos.map(ForkProvider.toUnspentOutput)
  }

  /**
   * @param {Address|null} address
   * @param {AssetId} unit
   * @returns {Promise<TransactionUnspentOutput[]>}
   */
  async getUnspentOutputsWithAsset(address, unit) {
    if (!address) {
      // Kupo answers this from its asset index; ogmios has no such query, and
      // the honest alternative -- the whole UTxO set -- is exactly the kind of
      // query that put this host into swap. Refuse rather than sweep.
      throw new Error(
        'getUnspentOutputsWithAsset needs an address on a fork: ogmios has no ' +
        'asset index, and scanning the whole preview UTxO set is not a query ' +
        'this provider will run'
      )
    }
    const policy = AssetId.getPolicyId(unit)
    const name = AssetId.getAssetName(unit)
    const utxos = await this.getUnspentOutputs(address)
    return utxos.filter(utxo => {
      const assets = utxo.output().amount().multiasset()
      return assets?.get(AssetId.fromParts(policy, name)) !== undefined
    })
  }

  /**
   * @param {AssetId} unit
   * @returns {Promise<TransactionUnspentOutput>}
   */
  async getUnspentOutputByNFT(unit) {
    throw new Error(
      'getUnspentOutputByNFT is not available on a fork: finding an NFT without ' +
      'an address needs an asset index, which no fork sidecar keeps. Query the ' +
      'address you minted to instead (' + unit + ')'
    )
  }

  /**
   * @param {TransactionInput[]} txIns
   * @returns {Promise<TransactionUnspentOutput[]>}
   */
  async resolveUnspentOutputs(txIns) {
    if (txIns.length === 0) return []
    const utxos = await this.ogmios.queryLedgerStateUtxo({
      outputReferences: txIns.map(txIn => ({
        transaction: { id: txIn.transactionId().toString() },
        index: Number(txIn.index())
      }))
    })
    return utxos.map(ForkProvider.toUnspentOutput)
  }

  /**
   * @param {DatumHash} datumHash
   * @returns {Promise<PlutusData>}
   */
  async resolveDatum(datumHash) {
    throw new Error(
      'resolveDatum is not available on a fork: ogmios serves no datum-by-hash ' +
      'query and there is no Kupo behind this provider. Use inline datums, or ' +
      'pass the datum in alongside the transaction (' + datumHash + ')'
    )
  }

  /**
   * Confirmation is "this transaction's first output is in the ledger's UTxO
   * set", asked of ogmios rather than Kupo. That reads false if something spends
   * output 0 between inclusion and the poll -- fine for a fork, where the only
   * other spender is the caller.
   * @param {TransactionId} txId
   * @param {number} [timeout] milliseconds
   * @returns {Promise<boolean>}
   */
  async awaitTransactionConfirmation(txId, timeout = 90_000) {
    const deadline = Date.now() + timeout
    for (;;) {
      const utxos = await this.ogmios.queryLedgerStateUtxo({
        outputReferences: [{ transaction: { id: txId.toString() }, index: 0 }]
      })
      if (utxos.length > 0) return true
      if (Date.now() > deadline) return false
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  /**
   * @param {string} scriptHash
   * @returns {Promise<Script>}
   */
  async resolveScript(scriptHash) {
    throw new Error(
      'resolveScript is not available on a fork: attach the script to the ' +
      'transaction, or spend a reference input that carries it (' + scriptHash + ')'
    )
  }

}
