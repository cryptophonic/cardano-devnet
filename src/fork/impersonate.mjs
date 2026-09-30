// Impersonation: act as an address whose keys nobody holds.
//
// On a fork-mode chain the ledger's witness rule is replaced past the fork slot:
// a transaction is authorised by ONE witness, the god key, and any other vkey
// witness makes it invalid (fixture fork-mode-god-key.md, cases A and B). So
// "impersonating" an address is not forging its signature -- it is spending its
// UTxOs while signing with the god key alone.
//
// That is the whole trick, and it is also the security property: because the god
// key is the only witness, the same transaction can never be replayed on the
// real network, where the address's own key would be required and the god
// witness would be extraneous.

import { NetworkId, Value } from '@blaze-cardano/core'

import { skeyWallet } from '../blaze-wallet.mjs'

/**
 * A blaze Wallet that spends one address's funds and signs with another's key.
 *
 * Every balance/address method answers for the impersonated address, so blaze's
 * coin selection and change both work against the victim's UTxOs; only signing
 * comes from the god key. The witness set contains exactly one vkey witness --
 * HotSingleWallet produces a single-witness set, and nothing here adds to it.
 */
export class ImpersonatedSigner {

  /**
   * @param {object} opts
   * @param {import('@blaze-cardano/core').Address} opts.address the impersonated address
   * @param {string} opts.godKeyPath a cardano-cli .skey for the fork's god key
   * @param {import('@blaze-cardano/query').Provider} opts.provider
   * @param {string} [opts.godKeyHash] expected hash, from the fork's manifest
   * @param {NetworkId} [opts.networkId]
   */
  constructor({ address, godKeyPath, provider, godKeyHash, networkId = NetworkId.Testnet }) {
    this.address = address
    this.provider = provider
    this.networkId = networkId
    this.god = skeyWallet(godKeyPath, provider)
    this.godKeyHash = this.god.address.getProps().paymentPart.hash.toString()

    // A god key that is not the one the node was started with fails at the
    // mempool with MissingVKeyWitnessesUTXOW, several minutes and one confusing
    // error later. The manifest records the hash the gates carry, so check here.
    if (godKeyHash && this.godKeyHash !== godKeyHash) {
      throw new Error(
        `god key at ${godKeyPath} hashes to ${this.godKeyHash}, but this fork's ` +
        `gates are set to ${godKeyHash}. A transaction signed with it would be ` +
        `rejected as MissingVKeyWitnessesUTXOW.`
      )
    }
  }

  // ------------------------------------------------- the impersonated address

  async getNetworkId() { return this.networkId }
  async getChangeAddress() { return this.address }
  async getUsedAddresses() { return [this.address] }
  async getUnusedAddresses() { return [] }
  async getRewardAddresses() { return [] }

  /** @returns {Promise<import('@blaze-cardano/core').TransactionUnspentOutput[]>} */
  async getUnspentOutputs() {
    return this.provider.getUnspentOutputs(this.address)
  }

  async getBalance() {
    let lovelace = 0n
    const tokens = new Map()
    for (const utxo of await this.getUnspentOutputs()) {
      const amount = utxo.output().amount()
      lovelace += amount.coin()
      amount.multiasset()?.forEach((quantity, assetId) => {
        tokens.set(assetId, (tokens.get(assetId) ?? 0n) + quantity)
      })
    }
    return new Value(lovelace, tokens)
  }

  /**
   * Collateral for a Plutus spend comes from the impersonated address too -- the
   * god key covers the collateral input's witness like any other (fixture
   * fork-mode-scripts.md 4b).
   */
  async getCollateral() { return [] }

  // ------------------------------------------------------- the god key's part

  /**
   * @param {import('@blaze-cardano/core').Transaction} tx
   * @param {boolean} [partialSign]
   * @returns {Promise<import('@blaze-cardano/core').TransactionWitnessSet>}
   *   a witness set holding ONLY the god key's vkey witness
   */
  async signTransaction(tx, partialSign = true) {
    return this.god.signTransaction(tx, partialSign)
  }

  /**
   * Attach the god witness to a transaction and hand it back, for callers that
   * want the signed transaction rather than a witness set. Any vkey witness
   * already on the transaction is REPLACED, not added to: past the fork slot a
   * second witness is what makes a transaction invalid, so leaving one in place
   * would build a transaction guaranteed to be rejected.
   * @param {import('@blaze-cardano/core').Transaction} tx
   * @returns {Promise<import('@blaze-cardano/core').Transaction>}
   */
  async sign(tx) {
    const witnessSet = tx.witnessSet()
    witnessSet.setVkeys((await this.signTransaction(tx, true)).vkeys())
    tx.setWitnessSet(witnessSet)
    return tx
  }

  async signData(address, payload) {
    return this.god.signData(address, payload)
  }

  async postTransaction(tx) {
    return this.provider.postTransactionToChain(tx)
  }

}
