# Fork-mode rate and epoch — test fixtures (Phase 9)

How fast a fork-mode chain can be driven, and what the ledger does when an
accelerated chain crosses an epoch boundary.

- Image: `ghcr.io/cryptophonic/cardano-node-ogmios:v7.0.0_11.1.2-custom-cb30ce58-faketime`
  (`sha256:d99bdaaa95e6…`), cardano-cli 11.2.3.0
- Golden DB as refreshed 2026-09-21: chain tip slot 123372484, epoch 1427 Conway
- All runs: `CARDANO_FORK_SLOT=123372484`, `CARDANO_FORK_BLOCK_EVERY=20`,
  god key hash `868e39685a4c0a57aeb579ce30edec4daaf49cf62a5cd055f9b8a06b`,
  pool `003c4963f9b5e81321ba1ef34e6ccf7787aa5fc139fdabf2961c0760` (unregistered)
- Acceleration is libfaketime's speed-up: `FAKETIME="@<t> x100"`, written by
  `scripts/set-faketime --rate 100 [--fake-monotonic]`.

libfaketime anchors a speed-up at **process start**, so a faked process sees
`target + rate * (real seconds since it started)`. Two consequences run through
everything below: a short-lived child (`date`) always reports the target itself,
and two containers started N real seconds apart are `rate * N` slots apart.

## 9a. Rate: which clock has to be faked — ARM 2

Identical runs, 200 real seconds each, differing only in whether
`CLOCK_MONOTONIC` is accelerated along with the wall clock.

| | Arm 1 `run-22` (monotonic real) | Arm 2 `run-23` (monotonic faked) |
|---|---|---|
| observed clock rate | 100.0x | 96.4x |
| chain extensions | 16 | 951 |
| slots spanned | 18740 | 19280 |
| **slots per forged block** (target 20) | **1171.25** | **20.27** |
| slot-gap histogram | 60, 200, 300, 360x2, 480, 580, 640, 760, 1020, 1120, 1440, 1480, 1980, 3740, 4220 | **20x944**, 40x3, 60x2, 80x2 |
| MissedSlots / BlockFromFuture / NoLedgerView | none | none |
| tip lag behind the node's own faked now | 0–22 slots (last 1) | 0–22 slots (last 0) |

**Arm 2 is the configuration to use.** The interesting part is that Arm 1 does
not fail with horizon errors — it produces none at all, and its tip stays glued
to its own clock. It simply skips most forge opportunities: `CLOCK_MONOTONIC`
drives the slot-wait timers, so while wall time runs at 100x the timers still
run at 1x, and by the time the node comes back round the wall clock has already
moved hundreds of slots past the next `BLOCK_EVERY` boundary. Cadence degrades
to "as fast as the node can physically cycle", not to a stalled chain.

Both arms crossed the 1427→1428 boundary during their window: the fork slot is
only 6716 slots short of it, which at x100 is 67 real seconds, so a
boundary-free rate measurement is not available at this rate from this golden
tip. Neither arm logged anything at the crossing.

## 9b. Epoch boundary, forger and follower

`run-24` (forger) and `run-25` (follower), both x100 with monotonic faked.

The follower joins the forger's **own network namespace**
(`--network container:devnet-node-isolated`, `scripts/follower-node`), so it
reaches the forger on `127.0.0.1:3001` while the namespace still contains
nothing but `lo` — the phase 8 isolation property is unchanged. A bridge
network between the two would have given that property up.

Because the speed-up anchors at process start and the follower must start
second (it needs the forger's namespace to exist), equal faketime targets would
put the follower's clock *behind* the forger's and every block it received
would look like a block from the future. The follower's target is therefore set
400 slots ahead; measured skew in this run was ~383 slots, in the safe
direction.

### What the boundary did

Boundaries crossed in `run-24`/`run-25`: **1427→1428, 1428→1429, 1429→1430**,
all at x100, on one opcert issued at KES period 951 and never reissued (the run
also crossed the KES period boundaries 951→952→953; note slot 123379200 is both
`1428 * 86400` and `952 * 129600`, so the first epoch boundary and a KES period
boundary are the same slot here).

- **Forging continues across the boundary.** Both nodes hold the last block of
  the old epoch and the first of the new one (123379180 and 123379200); the
  only irregularity is a single 40-slot gap at that boundary instead of 20.
- **Tip epoch increments**: `query tip` reports 1428, then 1429, then 1430.
- **Stake snapshot rotates by exactly one position.** Across 1428→1429, for
  pool `24d3394…` and for the totals: `after.stakeGo == before.stakeSet` and
  `after.stakeSet == before.stakeMark`.

      before  Go 73305016743835  Set 73330615385972  Mark 73359574440993
      after   Go 73330615385972  Set 73359574440993  Mark 73385043956552

- **Epoch nonce is defined and rotates**: `65fcac33…` → `ada752ec…`, with
  `evolvingNonce` reset to equal `candidateNonce` at the boundary. Blocks of the
  next epoch are accepted on both nodes, which is what a usable epoch nonce
  means in practice.
- **`blocksMade` carries the unregistered producer.** After 1428→1429,
  `blocksBefore` is `{003c4963…: 4238}` and nothing else — the whole of epoch
  1428, 98.1% of the 4320 blocks a 20-slot cadence allows. After 1429→1430 it is
  `{003c4963…: 4061}`. `blocksCurrent` restarts each epoch (145, then 155).
- **The reward calculation completes**, and its result is unusually legible
  here. Across 1429→1430:

      reserves  7564670677810741 -> 7560218028597886   (-4452649212855)
      treasury  7133881527491595 -> 7138334176704450   (+4452649212855)

  Exactly equal and opposite. Every registered pool made zero blocks that epoch,
  and the one pool that made all of them is unregistered, so it is not in the
  stake distribution and cannot be paid. The calculation runs to fixpoint and
  the entire epoch's monetary expansion falls through to the treasury, with
  nothing distributed to pools. `possibleRewardUpdate` reads `null` throughout —
  cardano-cli does not serialise the in-flight pulser, so it is not a usable
  probe; the account-state delta is.
- **The follower crossed every boundary in sync**, adopting the forger's blocks
  by identical hash at identical slots, and reached epoch 1430 as well.

Caveat: the isolated config silences `Forge.StateInfo`, which is the KES
countdown tracer, so KES evolution cannot be shown positively from the log.
The evidence that the opcert survived is negative and behavioural: ~8800 log
lines over ~14 chain-hours with no KES warning, no `MissedSlots`, no
`BlockFromFuture`, no `NoLedgerView`, and unbroken forging across two KES
period boundaries.

## 9c. What acceleration breaks: the mempool

At x100 with monotonic faked, **transactions cannot be submitted at all**:

    ConwayMempoolFailure "MempoolTxTooSlow (1.0132286s) ..."
    errdetails: {"MempoolRejectedByTimeoutSoft": 1.0132286}

The mempool's admission timeouts are measured on the node's own clock, so the
stock `ncMempoolTimeoutSoft = 1s` / `Hard = 1.5s` / `Capacity = 5s` are 10ms /
15ms / 50ms of real time. Validating a real transaction takes ~10ms, so every
submission overruns the soft timeout. Raise them in the run's config.json by the
same factor as the rate:

    "MempoolTimeoutSoft": 100, "MempoolTimeoutHard": 150, "MempoolTimeoutCapacity": 500

This needs a restart, and a restart under acceleration needs the faketime target
re-derived from the run's own last forged slot (`scripts/set-faketime <run>
--rate 100 --fake-monotonic`, no `--slot`) — otherwise the node restarts with a
clock far below its own chain tip. The restart re-adopted the chain exactly as
phase 5 found, and the opcert was not reissued.

## 9d. Governance: a god key can propose and vote, but cannot enact

Submitted in epoch 1430 on `run-24`, every witness supplied by `god.skey` alone
and every fee/deposit taken from the impersonated whale
`addr_test1vp8cprhse9pnnv7f4l3n6pj0afq2hjm6f7r2205dz0583egagfjah`.

| step | tx | result |
|---|---|---|
| register deposit-return account | `b40be278…` | included |
| split a collateral UTxO | `25b1c7d7…` | included |
| **ParameterChange** `minPoolCost 75000000 -> 123456789` | `9ff2d70e…` | **included** |
| **7 DRep votes, all Yes** | `c7f105a4…` | **included** |
| 2 CC hot votes (script creds) | — | **rejected** |

On-chain, the proposal reads `proposedIn 1430`, `expiresAfter 1460`,
`dRepVotes 7` (all `VoteYes`), `committeeVotes 0`, `stakePoolVotes 0`.

**Three prerequisites the god key does not waive.** Each failed first and had to
be satisfied properly:

1. `ProposalReturnAccountDoesNotExist` — the deposit-return stake credential
   must be registered on-chain first.
2. `InvalidGuardrailsScriptHash SNothing (SJust fa24fb30…)` — a ParameterChange
   must declare the constitution's guardrails script
   (`--constitution-script-hash`) and the tx must actually run it as a PlutusV3
   witness, with collateral. The script was already on this host
   (`~/Downloads/guardrails-script.plutus`) and hashes to exactly the
   constitution's `fa24fb30…`; it executed successfully inside the isolated
   container, so no network access was needed.
3. `MissingScriptWitnessesUTXOW (ScriptHash "3ecd2ec1…", ScriptHash "a11f594d…")`
   — the decisive one, below.

**The boundary of the god key's reach.** Preview's constitutional committee is
3 members with a 2/3 quorum, and every member's hot credential is a *script*
hash. Voting as them needs the script itself; the god key substitutes for **key**
witnesses, not for script witnesses, and the ledger says so plainly. Only 7
key-hash DReps are needed to clear the 67% DRep threshold (68.40% of the
non-abstain denominator, `alwaysAbstain` being 27.21% of total), and
impersonating those 7 worked in a single transaction — but the committee gate
cannot be passed.

At the 1430→1431 boundary the ledger did exactly what that implies:

    enactedGovActions: []      ratificationDelayed: False
    futurePParams: PotentialPParamsUpdate contents=null
    query protocol-parameters -> minPoolCost = 75000000   (unchanged)

So **the parameter change is not visible in `query protocol-parameters` after
the boundary, and should not be.** A fork-mode operator holding only the god key
can put a governance action on the chain and can manufacture DRep consent, but
cannot unilaterally enact a protocol-parameter change on a forked real chain,
because Conway gates it behind a script-based committee. Enacting one would need
the committee's scripts, or a golden DB whose committee is key-based.
