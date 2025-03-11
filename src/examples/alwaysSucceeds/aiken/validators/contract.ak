use cardano/transaction.{Transaction, OutputReference}

validator always_succeeds {

  spend(_datum: Option<Data>, _redeemer: Data, _utxo: OutputReference, _self: Transaction) {
    True
  }

}
