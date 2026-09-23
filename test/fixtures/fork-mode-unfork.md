# Fork-mode unfork threshold — test fixtures (Phase 7)

When can a fork-mode run be reset back onto real preview by just deleting the
volatile DB, and when does it need `db-truncater`? Threshold is the security
parameter **k = 432** (from shelley genesis). Runs used `BLOCK_EVERY=1` so k
blocks forge in ~k seconds instead of ~2.4 h at the normal 20-slot cadence.

Fork point S = golden tip **slot 123372484 / block 4684177** (hash `18671538…`).
Reset = stop the fork node, `rm -rf db/volatile`, restart the STOCK 11.1.2 node
networked (no keys, no env) against the same db.

## 7a. Fewer than k fork blocks → volatile-delete UNFORKS

`run-12`, forged **130** fork blocks (< 432), all still in `volatile/`; the
immutable tip was still a pre-fork real block (slot 123364565 / block 4683892).
After deleting `volatile/` and restarting stock+networked, the node discarded
the fork and caught up to the real preview tip:

    tip slot 123380310 block 4684435 epoch 1427 sync 100.00%   (GSM EnterCaughtUp)

## 7b. k or more fork blocks → volatile-delete does NOT unfork

`run-13`, forged **533** fork blocks (> 432). Now some fork blocks have been
copied into the ImmutableDB. After deleting `volatile/` and restarting
stock+networked, the node loads a **fork** block as its immutable tip and is
stuck there — it cannot adopt real preview, because that needs a rollback below
the immutable tip (to the fork point), which is forbidden:

    tip slot 123380527 block 4684302 hash 56331848… sync 100.00%   (UNCHANGED)
    0 "Chain extended" events — real (longer) preview chain never adopted.

It reports 100% "caught up" on a dead fork. This is how a >k reset manifests.

### Fix: db-truncater at S, then restart

    db-truncater --db <run>/db --truncate-after-slot 123372484 --config <config>
    → Truncating the ImmutableDB … new tip Tip {tipSlotNo = 123372484,
      tipBlockNo = 4684177, tipHash = 18671538…}   (the real golden tip)

Restart stock+networked → now catches up to real preview:

    tip slot 123381265 block 4684467 epoch 1428 sync 100.00%   (real blocks adopted)

## Rule for the devnet CLI

A reset can `rm -rf db/volatile` **iff the fork produced fewer than k = 432
blocks** (no fork block has reached the ImmutableDB). Once the fork is ≥ k
blocks deep, the volatile delete cannot unfork — the reset must run
`db-truncater --truncate-after-slot <S>` first.
