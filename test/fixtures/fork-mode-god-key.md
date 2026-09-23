# Fork-mode god-key rule — test fixtures

Ledger behaviour for the five witness cases (A–E), captured from a fork-mode
node running isolated on a preview fork. A and E are accepted; B–D are rejected
with the exact errors below.

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

## E. Non-payment (staking) witness role — god key only — ACCEPTED

Registers a stake credential we do NOT hold and delegates its vote to the
always-abstain DRep (Conway `RegDepositDelegVote`), paying the 2 ADA deposit
plus fee from a `WHALE_ADDR` UTXO. Under stock rules this needs TWO witnesses we
lack: the whale's payment key (to spend the input) and the stake credential's
key (the cert's DELEG witness). Signed with `god.skey` only.

- Run: `run-11`, `CARDANO_FORK_SLOT=123372484`, on the golden DB **refreshed to
  the live preview tip** (slot 123372484 / block ~4684180) on 2026-09-21 — the
  older run-9 tip was ~96 h stale, past the forecast horizon, so the fork node
  reported `CurrentSlotUnknown` and would not forge until the refresh.
- Victim stake credential (key we do not hold):
  `15949d7030edc41d52f9cba70186ea6720c1918262bd11dde8989f4a`
  (`stake_test1uq2ef8tsxrkug82jl896wqvxafnjpsv3sf3t6ywaazvf7js0zdfug`).
- Whale input spent: `0395ff3582ca4ed53c87aa27f9174de6730ad49e57a3e1c539c3afb4dfb4e685#0`.

      Transaction successfully submitted. Transaction hash is:
      {"txhash":"5e0a011e50f5a2e42465ee714363096c996574486a24567ec902c83bdedcb731"}

`query stake-address-info` on the victim address returns `[]` before, and after
inclusion in the next forged block:

      {
        "address": "stake_test1uq2ef8tsxrkug82jl896wqvxafnjpsv3sf3t6ywaazvf7js0zdfug",
        "rewardAccountBalance": 0,
        "stakeDelegation": null,
        "stakeRegistrationDeposit": 2000000,
        "voteDelegation": "alwaysAbstain"
      }

with the whale input consumed. A single god-key witness covered BOTH the payment
role (spending the whale UTXO) and the staking role (authorising the cert), so
the god key is not limited to payment witnesses — it stands in for non-payment
witness roles too.

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

## Re-run on a 45 h-stale DB under a faked clock (2026-09-23)

All five cases re-run end to end on `run-19` — a fresh reflink clone of the
**same** golden DB (tip slot `123372484`), no re-sync, the node's clock shifted
to `@2026-09-21 22:08:14` by `scripts/set-faketime` (see
`fork-mode-faketime.md`). Image: the rebuilt
`…:v7.0.0_11.1.2-custom-cb30ce58-faketime` (`sha256:542a73ebaede…`, the
`COPY --chmod=0755` fix). `CARDANO_FORK_BLOCK_EVERY=20`, gates otherwise as
above. Submitted with **stock** cardano-cli 11.2.3.0 (git rev `fef83fed`, a
different build from the in-image one) over the run's socket.

| case | expected | observed |
| --- | --- | --- |
| A god only | accepted | `57cfc5d82b1f272ddbd513efc3800e36632c32b19d5e2b073f332bc0fd634176`, included |
| B god + real key | rejected | `InvalidWitnessesUTXOW (VKey … "ce13cd43…")` |
| C ordinary own-key tx | rejected | `InvalidWitnessesUTXOW (… "ce13cd43…")` + `MissingVKeyWitnessesUTXOW ([KeyHash "868e3968…"])` |
| D no witnesses | rejected | `MissingVKeyWitnessesUTXOW ([KeyHash "868e3968…"])` |
| E staking role, god only | accepted | `5e0a011e50f5a2e42465ee714363096c996574486a24567ec902c83bdedcb731`, included |

Byte-for-byte the same failure strings as the run-9/run-11 originals. E even
reproduces the **same txhash** as the run-11 fixture above — same input, same
cert, same fee, so the body is identical.

Inputs differed from the originals only where the golden DB had moved on:

- A `3cd290ee…#0`, B `6446b302…#0`, D `66935c5c…#0`, E `0395ff35…#0` — all
  still unspent at the refreshed golden tip, so identical to the originals.
- C spent the faucet's own live preview UTXO `afadaa049f1e360aa643188ca99b651d
  658e6e3b24a128f0cb59ec6e9fcd8f25#1` (282.77 ADA) rather than the original
  `f7172e80…#1`, which no longer exists at this tip. Same shape: our funds,
  our key, valid under stock rules.

Confirmed on chain after the next forged blocks: `1000000000` lovelace at the
faucet address from A; C's input **still unspent** (so C really was rejected,
not silently included); `query stake-address-info` on the victim
`stake_test1uq2ef8tsxrkug82jl896wqvxafnjpsv3sf3t6ywaazvf7js0zdfug` goes from
`[]` to `stakeRegistrationDeposit: 2000000, voteDelegation: alwaysAbstain`.

Node-side `Mempool.RejectedTx` traces agree: 3 × `InvalidWitnessesUTXOW`
(B submitted twice, C once), 2 × `MissingVKeyWitnessesUTXOW` (C, D).

The point of the re-run: the god-key rule is unaffected by the clock shift, and
a stale golden DB no longer forces a re-sync before these can be exercised.
