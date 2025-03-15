use aiken/cbor
use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{quantity_of}
use cardano/transaction.{
  InlineDatum, OutputReference, Transaction, find_script_outputs,
}

pub type Counter {
  count: Int,
}

validator counter(
  validation_token_policy: ByteArray,
  validation_token_id: ByteArray,
) {
  spend(
    datum: Option<Counter>,
    _redeemer: Data,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(own_input) =
      list.find(tx.inputs, fn(input) { input.output_reference == own_ref })
    expect Script(own_hash) = own_input.output.address.payment_credential
    expect [own_output] = find_script_outputs(tx.outputs, own_hash)

    expect
      quantity_of(
        own_input.output.value,
        validation_token_policy,
        validation_token_id,
      ) == 1
    expect
      quantity_of(
        own_output.value,
        validation_token_policy,
        validation_token_id,
      ) == 1

    expect InlineDatum(output_datum) = own_output.datum
    expect Some(cur_count) = datum
    expect next_count: Counter = output_datum
    next_count.count == cur_count.count + 1
  }

  else(_) {
    fail
  }
}

test make_datum_0() {
  let datum = Counter { count: 0 }
  trace @"datum": datum
  cbor.diagnostic(datum) == @"121([_ 0])"
}
