# `devnet fork propose`/`vote`/`replace-committee` — test fixtures (Phase 14 / Step 6)

Wraps the manual cardano-cli workflow fixture 9d (`fork-mode-rate-and-epoch.md`)
proved by hand into a reusable CLI, and goes further: 9d stopped at "the
committee blocks enactment"; this step builds `replace-committee` specifically
to get past that. **The master plan's full acceptance test now passes**:
propose a `minPoolCost` change, vote it through, warp, and `query
protocol-parameters` shows it -- reproduced twice, on two different forks,
via the actual shipped `devnet fork replace-committee` command. Getting there
took two wrong turns, each instructive, both recorded below (14d-14f) rather
than edited out.

- Image: `ghcr.io/cryptophonic/cardano-node-ogmios:v7.0.0_11.1.2-custom-cb30ce58-faketime`
- cardano-cli 11.2.3.0 (host binary, `/mnt/cardano/bin/node-11.1.2/bin/cardano-cli`)
- Run: `sdk1`, fork slot 123372484

## 14a. Everything runs offline except query/submit -- because the god key is never in a run dir

`transaction sign` needs to read the signing key file; `cardano-cli conway
governance action create-*`, `vote create`, `build-raw`, `calculate-min-fee`
and `sign` all need no node connection at all. So `propose`/`vote` use the
**host** `$CLI` binary directly on files under `<run>/gov`, not the
containerized `isolated-node cli` -- that container only mounts `/rundir`,
and the god key deliberately never lives there (`cmd_create`'s own comment:
"a run directory is disposable and gets cloned, the identity is not").
Only `query utxo`/`query protocol-parameters`/`query drep-stake-distribution`/
`query spo-stake-distribution`/`transaction submit` go through
`isolated-node cli`, since only those need the live socket.

## 14b. Three real bugs, found live, none of them guessable from the docs

1. **`calculate-min-fee` and `transaction txid` both emit JSON now**
   (`{"fee": N}`, `{"txhash": "..."}`), not the plain-number/bare-hash text
   older cardano-cli produced. A naive `grep -oE '^[0-9]+'` silently returned
   empty, `gov_submit` died confusingly, and (worse, before a second fix) an
   *actually rejected* transaction still got reported as `proposed info:
   action {\n "txhash": ...` -- the raw JSON blob, not a real action id.
2. **`isolated-node cli`'s own exit code cannot be trusted.** A `transaction
   submit` that printed a real ledger rejection still returned 0 through the
   wrapper, and `set -e` did not catch it either (build-raw failures inside a
   `gov_submit()` called via command substitution behaved the same way --
   the script kept going with a missing body file). Every cardano-cli call in
   `gov_submit` now checks its own exit status explicitly rather than leaning
   on `set -e`.
3. **Sequential governance steps race their own unconfirmed change output.**
   `ensure_gov_account_registered` then `propose` moments later, both
   spending the same funding address, collided in the mempool ("All inputs
   are spent. Transaction has probably already been included") when the
   first transaction had not yet confirmed. Fixed by having `gov_submit`
   poll for its own change output before returning -- governance is
   sequential by nature here, unlike `generate`'s intentional fire-and-forget.

## 14c. Real governance transactions, all four proposal types

    $ devnet fork propose sdk1 info
    proposed info: action 5b4068b1bd41...#0

    $ devnet fork vote sdk1 --action 5b4068b1bd41...#0 --as drep:top:2 --yes
    (confirmed via query gov-state: dRepVotes has exactly those 2 keyHashes, VoteYes)

    $ devnet fork propose sdk1 param-change --min-pool-cost 123456789
    proposed param-change: action 2809bbd75f01...#0

The param-change path exercises everything fixture 9d found by hand:
registering a deposit-return account (reusing the god key's own payment key
hash as the stake credential -- no new key material, and the god key
satisfies the registration certificate's witness like any other), declaring
`--constitution-script-hash`, and attaching the guardrails Plutus script
(`~/Downloads/guardrails-script.plutus`) as `--proposal-script-file` with
collateral from a *second*, distinct UTxO at the funding address. It also
surfaced a requirement 9d didn't have to deal with explicitly:
**`--prev-governance-action-tx-id`/`--prev-governance-action-index` is
mandatory** once a group (`PParamUpdate`, `Committee`, `Constitution`,
`HardFork`) already has a prior action -- read live from `query gov-state`'s
`nextRatifyState.nextEnactState.prevGovActionIds`, omitting it is rejected
outright (`InvalidPrevGovActionId`).

DRep/SPO voter enumeration is live, not hardcoded: `query
drep-stake-distribution --all-dreps` / `spo-stake-distribution --all-spos`,
dropping the `drep-alwaysAbstain`/`drep-alwaysNoConfidence` pseudo-entries
(not votable credentials), sorted by stake. Recalibrated 2026-09-30, same
numbers fixture 9d found independently: **7 DReps clear 68.40% of
non-abstain DRep stake** (67% threshold), **19 pools clear 52.14%** of pool
stake (51% threshold) -- delegation hasn't shifted since 9d's original run.

## 14d. Wrong turn #1: NoConfidence alone just strands you

First instinct: NoConfidence is the one action type that doesn't itself need
committee approval, so clear the committee and every later action's
"committee approved" condition becomes vacuous. Verified NoConfidence itself
works cleanly:

    $ devnet fork replace-committee sdk1   # (first cut of this command)
    == proposing NoConfidence ==
    proposed no-confidence: action 9ba6a327...#0
    == voting DRep + SPO yes on NoConfidence (both thresholds apply) ==
    casting 7 drep vote(s) ...
    casting 19 spo vote(s) ...
    == warping to slot 123465601 to cross the epoch boundary ==
    arrived  slot 123466065  epoch 1429

    epoch 1429: query committee-state -> 3 members, each "nextEpochChange": "ToBeRemoved"
    epoch 1430 (one more boundary): query committee-state -> {"committee": {}, "threshold": null}

**A one-epoch lag, found live**: an action *ratifies* at the first boundary
after quorum (members show `ToBeRemoved`, still `Active`) and only *applies*
at the second. Every ratify-then-apply flow in this fixture budgets two
boundaries because of this.

But then a `minPoolCost` ParameterChange, DRep-voted well past threshold,
sat through five further boundaries without enacting
(`query protocol-parameters` stuck at 75000000 the whole time; full ruled-out
list -- threshold level, SPO eligibility, proposal-time snapshotting, DRep
activity -- preserved below in 14e). **The premise was inverted**: with no
committee, "committee approved" isn't vacuously true, it's unconditionally
false for most action types. NoConfidence clears the gate and leaves nothing
that can ever open it again except another committee-group action.

## 14e. Fable's diagnosis: `NoVotingAllowed` vs `NoVotingThreshold`

Handed the stuck-pointer data to Fable (Claude), which read cardano-ledger's
actual Conway ratification rule
(`Cardano/Ledger/Conway/Governance/Internal.hs`,
`votingCommitteeThresholdInternal`, applied via `committeeAccepted` in
`Rules/Ratify.hs`) rather than guessing:

    NoConfidence {}       -> NoVotingAllowed
    UpdateCommittee {}    -> NoVotingAllowed
    ParameterChange {}    -> threshold   -- SNothing when no committee/too small -> committeeAccepted = False, not True

`NoVotingAllowed` is a literal zero threshold that auto-passes (why
NoConfidence enacted). Every OTHER action type -- including ParameterChange
-- gets `NoVotingThreshold` (`SNothing`) when there's no committee, and
`committeeAccepted` reads `SNothing` as an unconditional **no**. There is no
"vacuously approved" state; NoConfidence can remove a committee and
UpdateCommittee can install one, and nothing else can enact until a real one
exists. Path out: install a real (god-key-hash) committee via
`UpdateCommittee`, since the *current* committee's own vote on that action
type is also `NoVotingAllowed` -- it cannot veto its own replacement, so
NoConfidence isn't even a prerequisite.

## 14f. Wrong turn #2: `--epoch 999999999`

First attempt at installing a new committee (both post-NoConfidence with an
empty committee, and directly against `replay1`'s still-intact real one,
removing all 3 real members and adding 3 new key-hash ones in one combined
action) used `--epoch 999999999` for each new member's expiry. Proposed
cleanly, voted DRep (68.4%) + SPO (52.1%) yes -- comfortably past every
plausible threshold -- crossed 2, then 3, epoch boundaries. Never ratified:
`committee-state` showed the untouched original members with
`"nextEpochChange": "NoChangeExpected"` the entire time, not even a pending
flag. Root cause, found by re-checking genesis rather than guessing again:
`committeeMaxTermLength` is **365** epochs. `999999999` is nonsense against
that policy. cardano-cli does not validate an out-of-policy expiry
client-side, the mempool accepts the resulting CBOR without complaint, and
the proposal just silently never ratifies -- no error anywhere, on either
fork tested.

## 14g. The working path, verified twice

One `update-committee` action: remove every current member (whichever
credential type they are), add N new god-key-hash members with expiry
`currentEpoch + min(committeeMaxTermLength, 300)`, threshold 2/3. Vote
DRep + SPO yes (the *current* committee's own vote doesn't matter -- 14e).
Warp two boundaries. Authorize a hot key for each new member (hot == cold,
both satisfied by the god key regardless of which hash was nominally
expected -- fork-mode-god-key.md). No NoConfidence, no empty-committee
limbo, one command:

    $ devnet fork replace-committee sdk1
    == proposing UpdateCommittee: remove 0 real member(s), add 3 new god-key-hash member(s) (expiry epoch 1736) ==
    proposed update-committee: action fcc42c21...#0
    == voting DRep + SPO yes ==
    == warping two boundaries: ratifies at the first, applies at the second ==
    == authorizing a hot key for each new cold member ==
    committee replaced: 3 key-hash member(s), threshold 2/3, hot keys authorized.
    Vote as this committee on any FUTURE proposal with:
      devnet fork vote sdk1 --action <TXID#IX> --as cc-keys:6a0d3da2...,8b4af44b...,675fdf15... --yes

Then, the master plan's actual acceptance test:

    $ devnet fork propose sdk1 param-change --min-pool-cost 123456789
    proposed param-change: action 04ab4970...#0
    $ devnet fork vote sdk1 --action 04ab4970...#0 --as drep:top:7 --yes
    $ devnet fork vote sdk1 --action 04ab4970...#0 --as cc-keys:6a0d3da2...,8b4af44b...,675fdf15... --yes
    $ devnet fork warp sdk1 --to-epoch 1439   # ratify
    $ devnet fork warp sdk1 --to-epoch 1440   # apply
    $ query protocol-parameters -> minPoolCost: 123456789

**Enacted.** Reproduced independently on `replay1` (a second fork, real
committee intact at proposal time, same combined remove+add) before fixing
and re-verifying `replace-committee` itself on `sdk1` as one clean command --
not the same lucky run twice.

One real, unrelated finding along the way: retrying with `--min-pool-cost
987654321` (a ~13x jump from 75000000, vs. 123456789's ~1.6x) got rejected
by the guardrails script itself --
`PlutusFailure ... CekError ... "error"` -- a genuine constitutional policy
check on the proposed value, not a bug in this tooling. The guardrails
script enforces *something* about how large a jump is acceptable; what
exactly was not characterized.

## What this does not establish

- **CC voting with real script credentials.** `vote sdk1 --as cc
  --cc-scripts <dir>` checks each supplied script against `query
  committee-state`'s current hot credentials and refuses cleanly if none
  match (the safety check itself was exercised); actually casting a vote as
  preview's *real* committee needs its members' real scripts, which are not
  obtainable (same conclusion fixture 9d already reached). `cc-keys:H1,H2,..`
  (this session's own god-key-hash committee) is the exercised, working path.
- **The guardrails script's exact acceptance policy.** Confirmed it rejects
  at least one large jump and accepts at least one smaller one; the actual
  boundary (percentage? absolute cap? per-parameter?) was not mapped.
- **Treasury withdrawals.** `sdk1`'s inherited chain history already has
  several pending `TreasuryWithdrawals` proposals (visible in every
  `gov-state` dump in this fixture) from a source this session never
  investigated; `propose`/`vote` were not tried against that action type.
- **A committee with real, held (non-arbitrary) key material**, or one
  larger than the genesis `committeeMinSize`. Both would work the same way;
  neither was tried.
