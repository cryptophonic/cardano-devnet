# Fork-mode scripts under impersonation — test fixtures (Phase 4)

Native and Plutus scripts run under fork mode, every witness/fee/collateral role
supplied by the single god key from the impersonated whale. Proves phase-1 and
phase-2 validation stay fully live under impersonation.

- Image: `ghcr.io/cryptophonic/cardano-node-ogmios:v7.0.0_11.1.2-custom-cb30ce58`
- cardano-cli 11.2.3.0 ; aiken v1.1.9
- Run: `run-11`, `CARDANO_FORK_SLOT=123372484`, `CARDANO_FORK_BLOCK_EVERY=20`,
  god key hash `868e39685a4c0a57aeb579ce30edec4daaf49cf62a5cd055f9b8a06b`,
  on the golden DB refreshed to the live preview tip 2026-09-21.
- Impersonated whale (keys not held):
  `addr_test1vp8cprhse9pnnv7f4l3n6pj0afq2hjm6f7r2205dz0583egagfjah`.

## 4a. Native script mint (`RequireSignature` of an unheld key) — INCLUDED

Policy = `{ "type": "sig", "keyHash": "d7d44701870ae8fff74b0a12789faa432c638105878a1c1a9a472f31" }`
(the signer key is freshly generated and never used — we do not hold it).
Policy id `3a4ba839a17e7bbe233a6f6244f403a163723007ccf278598f68fb70`,
asset `FORK` (`464f524b`). Mint 1, fee from the whale, signed god.skey only.

    txhash 4f2864892ef920dff25644332bb45d128866eb0f5bf55f75db2d1292ea11086f

`query utxo` then shows `…#0  1 3a4ba839….464f524b + 2000000 lovelace` at the
whale. The native script's required signature was satisfied by the god key alone.

## 4b. Plutus V3 success path (redeemer == 42) — INCLUDED

Validator (aiken, PlutusV3):

    validator eq42 {
      spend(_datum: Option<Data>, redeemer: Int, _own_ref: Data, _self: Data) {
        if redeemer == 42 { True } else { fail @"redeemer must be 42" }
      }
    }

Script address `addr_test1wpfwvzusx9858q8ufknwld93qyhf05z0h7k2qrgmj6yw5dsfdpv7h`
(untraced build). Lock 5 ADA (inline datum) then spend with redeemer 42;
collateral + fee from the whale, signed god.skey only.

    lock   txhash e181ee2f064b162a03cd4fcd26a6924511ac8a4f060d66ecde1c10ce011137c8
    spend  txhash 22258f3689d6e5e052963e552d1ba3b13720eb9ba1d8cf6ff8c7e375ebd66d79

Spend included; the script UTXO is consumed and ~4.82 ADA (5 − fee) returns to
the whale. Correct redeemer → validator returns True → phase-2 passes.

## 4c. Plutus V3 failure path (redeemer == 41) — REJECTED (phase-2)

Same validator rebuilt with traces (`aiken build --trace-level verbose`),
address `addr_test1wrnexa4ws3zlkgt4secqtjjdegu2g7d78pu4m20p2yjx4zgmwl35g`
(script hash `e79376ae8445fb2175867005ca4dca38a479be38795da9e151246a89`).
Lock 5 ADA (`44f0e0fe…#0`), then spend with redeemer 41.

`transaction build` refuses to build it, surfacing the validator's trace:

    Error: The following scripts have execution failures:
    the script for transaction input 0 … failed with:
      Script language: PlutusV3   Protocol version: Version 11
      Script evaluation error: The machine terminated because of an error,
        either from a built-in function or from an explicit use of 'error'.
      Script execution logs: redeemer must be 42

Built raw (isValid=true) and submitted, the **fork node** rejects it at the
mempool (`Mempool.RejectedTx`, rejected txid `38cbcb66…`), no collateral taken:

    ShelleyTxValidationError ShelleyBasedEraConway (ConwayApplyTxError
      (ConwayUtxowFailure (UtxoFailure (UtxosFailure
        (ValidationTagMismatch Phase2Valid (FailedUnexpectedly (PlutusFailure
          "The PlutusV3 script failed: … The plutus evaluation error is:
           CekError … explicit use of 'error' … The protocol version is: Version 11
           … Redeemer: 41")))))))

Wrong redeemer → validator `fail`s → phase-2 rejects. Fork mode replaces
witnesses but does NOT bypass script validation.
