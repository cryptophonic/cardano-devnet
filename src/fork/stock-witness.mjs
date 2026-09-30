// Would the stock ledger accept this transaction's witnesses?
//
// Fork mode's god-key rule is a replacement, not an addition: past the fork slot
// one god witness authorises everything, and a second vkey witness invalidates
// the transaction (fixture fork-mode-god-key.md, A and B). The security property
// that makes this safe is the mirror image -- a transaction the fork accepts must
// be one the real network would reject, or it could be replayed there.
//
// This checks that locally, from the transaction and its resolved inputs, with no
// second node involved: stock Conway rules require a vkey witness for every
// key-hash payment credential being spent, plus every declared required signer,
// and raise MissingVKeyWitnessesUTXOW naming the ones absent. Extraneous
// witnesses are NOT a stock failure -- fixture case B is valid stock-side and
// rejected by the fork precisely so it can never be replayed.

import { CredentialType, Hash28ByteBase16, blake2b_224, HexBlob } from '@blaze-cardano/core'

/**
 * @param {import('@blaze-cardano/core').Transaction} tx
 * @param {import('@blaze-cardano/core').TransactionUnspentOutput[]} resolvedInputs
 *   the UTxOs the transaction spends, resolved -- an input's required witness is
 *   a property of the output being spent, not of the input
 * @returns {{ ok: boolean, required: string[], provided: string[], missing: string[],
 *             extraneous: string[], reason: string|null }}
 *   `ok` is what the STOCK ledger would say. `missing` is what it would report as
 *   MissingVKeyWitnessesUTXOW; `extraneous` is informational, since stock rules
 *   ignore surplus witnesses and fork mode does not.
 */
export const stockWitnessCheck = (tx, resolvedInputs) => {
  const body = tx.body()

  const required = new Set()
  const byRef = new Map(resolvedInputs.map(utxo =>
    [`${utxo.input().transactionId()}#${utxo.input().index()}`, utxo]))

  for (const input of body.inputs().values()) {
    const utxo = byRef.get(`${input.transactionId()}#${input.index()}`)
    if (!utxo) {
      throw new Error(
        `stockWitnessCheck: input ${input.transactionId()}#${input.index()} was ` +
        `not among the resolved inputs, so what it requires is unknown`
      )
    }
    const credential = utxo.output().address().getProps().paymentPart
    // a script credential is satisfied by the script, not by a key
    if (credential?.type === CredentialType.KeyHash) required.add(credential.hash.toString())
  }
  // collateral is spent by the ledger on a phase-2 failure, so it needs witnesses too
  for (const input of body.collateral()?.values() ?? []) {
    const utxo = byRef.get(`${input.transactionId()}#${input.index()}`)
    const credential = utxo?.output().address().getProps().paymentPart
    if (credential?.type === CredentialType.KeyHash) required.add(credential.hash.toString())
  }
  for (const signer of body.requiredSigners()?.values() ?? []) {
    required.add(signer.toString())
  }

  const provided = new Set()
  for (const [vkey] of tx.witnessSet().vkeys()?.toCore() ?? []) {
    provided.add(Hash28ByteBase16(blake2b_224(HexBlob(vkey))).toString())
  }

  const missing = [...required].filter(hash => !provided.has(hash))
  const extraneous = [...provided].filter(hash => !required.has(hash))

  return {
    ok: missing.length === 0,
    required: [...required],
    provided: [...provided],
    missing,
    extraneous,
    reason: missing.length === 0 ? null
      : `MissingVKeyWitnessesUTXOW (NonEmptySet (fromList [${
          missing.map(hash => `KeyHash {unKeyHash = "${hash}"}`).join(',')}]))`
  }
}
