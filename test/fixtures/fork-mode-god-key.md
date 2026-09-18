# Fork-mode god-key rule — test fixtures

Exact ledger errors for the four witness cases, captured from a fork-mode node
running isolated on a preview fork.

- Image: `ghcr.io/cryptophonic/cardano-node-ogmios:v7.0.0_11.1.2-custom-cb30ce58`
  (the tag is the node binary's sha256 prefix; `cardano-node --version` still
  reports git rev `a3c7202`)
- cardano-cli 11.2.3.0 (stock and in-image, git rev `c2ebdc87`)
- Run: `run-9`, `CARDANO_FORK_SLOT=123025119`, `CARDANO_FORK_BLOCK_EVERY=20`,
  `CARDANO_FORK_POOL_ID=003c4963f9b5e81321ba1ef34e6ccf7787aa5fc139fdabf2961c0760`,
  `CARDANO_FORK_GOD_KEY=868e39685a4c0a57aeb579ce30edec4daaf49cf62a5cd055f9b8a06b`

Keys:

| role | key hash | vkey |
| --- | --- | --- |
| god key | `868e39685a4c0a57aeb579ce30edec4daaf49cf62a5cd055f9b8a06b` | `1afab23d5b8c6c427c1d076e8c6dc80d20e4add72350de7295b1cd0f5ed9edb7` |
| a real key (`faucet`) | `9783be7d3c54f11377966dfabc9284cd6c32fca1cd42ef0a4f1cc45b` | `ce13cd433cdcb3dfb00c04e216956aeb622dcd7f282b03304d9fc9de804723b2` |

Spent address, whose keys we do not hold (top preview address by wealth):
`addr_test1vp8cprhse9pnnv7f4l3n6pj0afq2hjm6f7r2205dz0583egagfjah`.

Each case spends its own input, so one case can never mask another.

## A. God key only — ACCEPTED

Spends `3cd290ee21921a13d498e610b8569578d05d9ce3a9542b1267d0889aebd15ab9#0`
(10,000 ADA), pays 1,000 ADA to our address.

    Transaction successfully submitted. Transaction hash is:
    {"txhash":"10d7a644d453977e22a8f0c96f18c75cb2a32bcbee3606547b861d1beee6c1d9"}

`query utxo` on our address then shows `10d7a644…#0  {'lovelace': 1000000000}`
and the input is gone from the spent address.

## B. God key + a real key — REJECTED

Spends `6446b3022eccf3073ae9de762fa9054ffbfad206ebe06d32be02bbd28b51570c#0`.

    ConwayUtxowFailure (InvalidWitnessesUTXOW (VKey (VerKeyEd25519DSIGN "ce13cd433cdcb3dfb00c04e216956aeb622dcd7f282b03304d9fc9de804723b2") :| []))

The real key's vkey is named as the offending witness.

## C. Ordinary tx, own preview funds, own key — REJECTED (replay protection)

Spends `f7172e804b06179e222cbe83c8712cb9e3ae0bb94a4492cb10bfdfd64d8aebcd#1`,
a transaction that would be valid on real preview. Two failures:

    ConwayUtxowFailure (InvalidWitnessesUTXOW (VKey (VerKeyEd25519DSIGN "ce13cd433cdcb3dfb00c04e216956aeb622dcd7f282b03304d9fc9de804723b2") :| []))
    ConwayUtxowFailure (MissingVKeyWitnessesUTXOW (NonEmptySet (fromList [KeyHash {unKeyHash = "868e39685a4c0a57aeb579ce30edec4daaf49cf62a5cd055f9b8a06b"}])))

## D. No witnesses — REJECTED (stock failure)

Spends `66935c5ce35e9e67003eeca34b4514ce949ac287dfcf63c9c824687ef29ad2de#0`.

    ConwayUtxowFailure (MissingVKeyWitnessesUTXOW (NonEmptySet (fromList [KeyHash {unKeyHash = "868e39685a4c0a57aeb579ce30edec4daaf49cf62a5cd055f9b8a06b"}])))

## How cardano-cli reports them

All three rejections decode in stock cardano-cli 11.2.3.0 and in the image's
cli identically, e.g. for B:

    Error: Error while submitting tx: ShelleyTxValidationError ShelleyBasedEraConway (ConwayApplyTxError (ConwayUtxowFailure (InvalidWitnessesUTXOW (VKey (VerKeyEd25519DSIGN "ce13cd433cdcb3dfb00c04e216956aeb622dcd7f282b03304d9fc9de804723b2") :| [])) :| []))

The same reasons appear in the node's `Mempool.RejectedTx` trace at
`detail: DMaximum` (a default in runs made by `scripts/new-isolated-run`).

## Note on InvalidWitnessesUTXOW

In the stock ledger `InvalidWitnessesUTXOW` means a signature failed to verify.
Here the signature is valid; fork mode uses the constructor to mean "this
witness is not allowed past the fork slot". It was chosen because stock
clients can decode it — an earlier build used a new constructor
(`ForkModeExtraneousWitness`, CBOR key 19) that no available cardano-cli could
decode, so B and C surfaced as `DeserialiseFailure … not a valid key: Error: 19`.

## History

| build | A | B | C | D | readable by cli |
| --- | --- | --- | --- | --- | --- |
| `edb52d4` | accepted | rejected (`ForkModeExtraneousWitness`) | rejected | rejected | B, C: no |
| `cb30ce58` | accepted | rejected (`InvalidWitnessesUTXOW`) | rejected | rejected | yes |

Case B is the security property: a god + real-key tx is valid under stock
rules (verified on a gates-unset node), so if the fork accepted one it would be
replayable on the real network.
