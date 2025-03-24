use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{quantity_of}
use cardano/transaction.{OutputReference, Transaction, find_script_outputs}

validator dex(
  // parameterized by (DEX token A, DEX token B)
  token_a_policy: ByteArray,
  token_a_name: ByteArray,
  token_b_policy: ByteArray,
  token_b_name: ByteArray,
) {
  spend(
    _datum, 
    _redeemer, 
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    // Grab our spending input and output to this script hash
    expect Some(own_input) =
      list.find(tx.inputs, fn(input) { input.output_reference == own_ref })
    expect Script(own_hash) = own_input.output.address.payment_credential
    expect [own_output] = find_script_outputs(tx.outputs, own_hash)

    // Check swap amounts, and swap happens with non-decreasing K 
    // (rounding error can cause K to slightly increase with each swap)
    let tokenAin =
      quantity_of(own_input.output.value, token_a_policy, token_a_name)
    let tokenBin =
      quantity_of(own_input.output.value, token_b_policy, token_b_name)
    let tokenAout = quantity_of(own_output.value, token_a_policy, token_a_name)
    let tokenBout = quantity_of(own_output.value, token_b_policy, token_b_name)
    let kIn = tokenAin * tokenBin
    let kOut = tokenAout * tokenBout
    let swapAforB = tokenBout < tokenBin && tokenAout > tokenAin
    let swapBforA = tokenAout < tokenAin && tokenBout > tokenBin
    let validSwap = swapAforB || swapBforA
    let constantK = kOut >= kIn

    validSwap && constantK
  }

  else(_) {
    fail
  }
}
