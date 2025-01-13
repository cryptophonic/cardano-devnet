use aiken/cbor
use cardano/transaction.{
  OutputReference
}
use aiken/transaction/credential.{ScriptCredential}
use aiken/transaction/value.{quantity_of}

type CounterDatum {
  count: Int,
}

validator increment(validation_token_policy: ByteArray, validation_token_id: ByteArray) {

  spend(datum: Option<CounterDatum>, redeemer: Void, own_ref: OutputReference, tx: Transaction) {
    expect Some(own_input) = list.find(
      tx.inputs,
      fn (input) {input.output_reference == own_ref}
    )
    expect Script(own_hash) = own_input.output.address.payment_credential
    expect Some(output) = list.find(
      tx.outputs,
      fn (output) {output == own_hash}
    )
  }

}

  /*
  fn increment(datum: CounterDatum, _redeemer: Void, ctx: ScriptContext) -> Bool {
    expect Spend(output_reference) = ctx.purpose
    expect Some(own_input) =
      ctx.transaction.inputs |> find_input(output_reference)
    expect ScriptCredential(own_hash) =
      own_input.output.address.payment_credential
    expect [output] = find_script_outputs(ctx.transaction.outputs, own_hash)

    // Confirm state token is spent and moved into new output
    expect
      quantity_of(
        own_input.output.value,
        validation_token_policy,
        validation_token_id,
      ) == 1
    expect
      quantity_of(output.value, validation_token_policy, validation_token_id) == 1

    // Check next datum's count is incremented by one
    expect InlineDatum(maybe_datum) = output.datum
    expect nextDatum: CounterDatum = maybe_datum
    nextDatum.count == datum.count + 1
  }
  */
}

test make_datum_0() {
  let datum = CounterDatum { count: 0 }
  cbor.diagnostic(datum) == @"121([_ 0])"
}
