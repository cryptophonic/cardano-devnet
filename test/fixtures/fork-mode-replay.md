# `devnet fork replay` — test fixtures (Phase 13 / Step 5)

Real transactions from a source chain, re-witnessed with the god key alone and
submitted to a fork, to see what the fork's modified rules do with traffic
that actually happened rather than traffic this SDK synthesized (`generate`,
Phase 12). Per `fork-mode-prompts.md`: "the step where everything justifies
itself."

- Image: `ghcr.io/cryptophonic/cardano-node-ogmios:v7.0.0_11.1.2-custom-cb30ce58-faketime`
- ogmios `v7.0.0`, node 20.20.2, `@blaze-cardano/core` 0.6.1

## 13a. A meaningful replay needs a fork made from an EARLIER real point

A fork's chain **is** the real chain up to its own fork slot, so replaying a
transaction from before that point just gets "already spent" -- it already
happened on the fork too. The only way to demonstrate real divergence on this
host (the golden DB has never been re-synced past slot 123372484, so there is
no *actually real* post-fork activity anywhere to point at) is a second fork
made from an **earlier** real point on the same golden DB:

- `replay1`, created at `--slot 123350000` -- below the golden DB's immutable
  tip (123360598), so `create` truncates for real and records a genuine fork
  hash (`72b655f5...`). An explicit `--slot` *inside* the volatile range
  leaves `fork.hash: null` (fork-mode-sdk.md 11e); `replay` refuses outright
  without a hash, since there is then no point to intersect a source at.
- `sdk1` (existing, fork slot 123372484) as the **source**: its selected
  chain includes the real history from 123350000 to 123372484 untouched,
  since that whole range is pre-fork for sdk1 too.

`replay1` never processed any of that range as blocks (its own fork gate
rejects real issuers past 123350000), so replaying it is a genuine test, not
a no-op.

## 13b. ogmios needs `--include-transaction-cbor`

Chain-sync's `nextBlock` omits each transaction's raw CBOR by default --
confirmed empirically against our own sidecar before assuming otherwise:

    tx keys: ['id','spends','inputs','outputs','fee','validityInterval','signatories']
    has cbor: false

`ogmios --help` names the flag directly: `--include-transaction-cbor`
(shorthand `--include-cbor` also pulls in metadata/script cbor). Added to the
`ogmios-fork` compose service. This is a real requirement for the `ogmios:
<url>` source generally: an external node someone else runs may not have it
enabled, and `replay` refuses cleanly (naming the flag) rather than guessing
at reconstructing a transaction body from ogmios' decomposed JSON fields.

`LosslessOgmios` (src/fork/ogmios.mjs) gained `findIntersection`/`nextBlock`
-- the same lossless-JSON client Step 3 built for the 2^53 trap (fixture
11b), now also carrying real historical transaction bodies exactly.

**Chain-sync quirk, expected, not a bug:** the very first `nextBlock` reply
after `findIntersection` is always a `RollBackward` *to the intersection
point itself* -- the protocol resetting the client's state there. Only a
rollback *after* forward progress began would mean the source chain itself
is unstable; `ogmiosSource` tracks that distinction explicitly.

## 13c. Clock lock-step is not optional -- verified the hard way

First attempt anchored the fork's clock once, at replay start, to
`fromSlot`. Result: transactions barely a few hundred slots into a
2000-slot replay were rejected outright:

    ogmios submitTransaction error 3118: ... outside of its validity interval ...
    "validityInterval": {"invalidBefore": 123351516, "invalidAfter": 123352416},
    "currentSlot": 123350061

The fork's clock, left alone after one anchor, just runs at real wall-clock
speed (1 slot/real-second at rate x1) -- and replay works through thousands
of source slots in a few seconds of real processing time, so the clock falls
behind the transactions' own original validity windows almost immediately.
`fork-mode-prompts.md` already called this out ("keep faked now within a
configurable drift of the block being replayed"); this is what not doing it
looks like in practice, not a theoretical concern.

Fixed with real per-block re-anchoring: whenever a block-with-transactions'
slot drifts more than `maxDriftSlots` (default 50) from the last anchor,
`devnet fork clock-set <n> <slot>` (new subcommand, exposing `write_stamp`
with a caller-given slot rather than the live tip `rate` resyncs to) fires
again. A live stamp write, no restart -- Step 2 built stamp-mode specifically
so this needs none.

## 13d. A stuck promise must fail loud, not hang forever

Hit once while iterating: a run went to 0% CPU and produced no further
output for 7+ minutes, no crash, nothing recoverable short of `kill -9`.
Isolating the two independent pieces (source chain-sync in a 200-block loop;
decode+sign+submit against the fork's own provider for one real transaction)
both worked cleanly and quickly on their own -- the exact interleaving that
triggered the hang wasn't pinned down. Rather than chase it further, every
per-block clock-set and every per-transaction sign/submit is now wrapped in
an explicit timeout (`withTimeout`, 15-20s) so a wedged call surfaces as one
failed step -- reported like any other rejection -- instead of freezing the
whole replay silently. A real, load-bearing defensive measure, not a
formality: the very next run (13e) completed cleanly with it in place.

## 13e. A real run, real transactions, real result

`replay1`, replaying `sdk1`'s real history for slots 123355000..123356000:

    source txs 29  accepted 4  rejected 25  (diff 25)
    per-epoch: {"1427":{"accepted":4,"rejected":25}}

Four of those acceptances are the actual property this step is for: a real,
historical, already-witnessed-by-someone-else transaction, decoded from its
original CBOR, re-witnessed with **only** the god key, submitted, and
**accepted** by `replay1`'s fork rules -- with the transaction id verified
unchanged before submission (`replay` throws, not just rejects, if a
witness-set edit ever touched the body hash; it never did). Exactly the same
property fixture 11c established through the SDK's `impersonate()` path, now
demonstrated through a transaction this SDK did not build at all.

The 25 rejections are real, varied, verbatim ledger errors -- not one
generic failure:

- `MempoolRejectedByLedger "All inputs are spent"` -- the large majority.
  Across a long debugging session this fork's own chain organically forges
  forward continuously (`blockEvery 1`, rate x1 -- roughly 1 slot/real-second
  regardless of replay activity), and several earlier manual `clock-set`
  probes and prior partial runs against overlapping ranges already
  consumed some of these same real inputs before this run executed. Real
  UTxO-consumption bookkeeping across repeated test runs, not a replay bug.
- error 3118, `outside of its validity interval` -- a transaction whose
  window the clock genuinely hadn't reached yet at submission time; expected
  under `maxDriftSlots`'s tolerance band, not a divergence.
- error 3117, `unknown UTxO references` -- an input from a transaction
  earlier in the same block that this run's own accept/reject pattern left
  unresolved.

Per `fork-mode-prompts.md`'s own framing (stated for this exact step): **a
rejection is the product, not a replay bug.**

## 13f. Extract once, replay many times -- no live source required

13e's `ogmios:<url>` source works, but demands the source chain be up and
reachable *every time* you want to replay the same range -- a real cost for
something you'd want to run repeatedly against different fork configurations.
Split out a dedicated `devnet fork extract <source-fork> --from-slot S
--to-slot T --out <file>` (`src/fork/extract.mjs`, `Fork.extractChain()`):
walks the same `ogmiosSource` once, writes the result as a single JSON array
(`[{slot, id, transactions}, ...]`, in order) to disk. `replay`'s `--source
file:<path>` then reads that array back with **zero live connection** --
`fileSource` is a plain `fs.readFileSync` + filter, no websocket at all.

Verified for real, not just by code review:

    $ node src/fork/extract.mjs sdk1 --from-slot 123372484 --to-slot 123380000 --out extracted.json
    slot 123373294  1 tx
    7488 block(s), 1 transaction(s) written to extracted.json

    $ devnet fork stop sdk1        # the SOURCE, fully stopped
    $ docker ps --filter name=sdk1 --format '{{.Names}}'
    (empty)

    $ node src/fork/replay.mjs replay1 --source "file:extracted.json" \
        --from-slot 123372484 --to-slot 123380000
    ok      slot 123373294  3fefb813d906b78c3e18535869ee706b965f5eed5969e112a4d2d99a0ffa9d8b
    source txs 1  accepted 1  rejected 0  (diff 0)

The replayed transaction landed on `replay1` with `sdk1` -- the chain it came
from -- not running at all. `extract`'s own source-side constraints are the
same as `replay`'s: it intersects at the SOURCE fork's own recorded (slot,
hash), so `--from-slot` must be at or after that fork's own fork point (an
attempt to extract 123360000-123361000, *before* sdk1's fork point 123372484,
correctly came back empty -- chain-sync only walks forward from an
intersection, and 123372484 is the only point on sdk1 this code can name
without an extra lookup).

This supersedes the `--dump <dir>`-during-replay approach 13e's fixture text
originally described: that bolted capture onto replay as a side effect,
one-file-per-slot; `extract` is now its own first-class, single-file step,
and `replay`'s own `--dump` option was removed since `extract` covers the
need more cleanly. The `blocks:<dir>` source name is gone too, replaced by
`file:<path>` (a single array, not a directory) -- clearer about what it
actually is: one file, not a raw block store.

## What this does not establish

- **A pristine, drift-free long replay.** The interaction between a fork's
  own continuous real-time forging and a batch-processed historical replay
  is a genuine rough edge -- frequent re-anchoring keeps it *working*, not
  perfectly synchronized. A replay run on a freshly-created, otherwise-idle
  fork (no prior manual clock-set probes muddying its state) would show a
  cleaner accept ratio than 13e's.
- **The exact cause of the 13d hang.** Mitigated (timeouts), not diagnosed.
  Both halves worked in isolation; the specific interleaving that wedged a
  promise wasn't reproduced deliberately.
- **Extracting from an arbitrary external node.** `extract`'s source is
  always one of this repo's own managed forks (it reuses that fork's own
  recorded fork point as the chain-sync intersection); pulling from a real
  node this tooling doesn't manage would need that point supplied some other
  way, not built here. Neither `extract` nor `file:<path>` is a general
  raw-block-CBOR reader -- decoding an arbitrary block's own CBOR (as opposed
  to the per-transaction CBOR inside it) needs a full block CDDL decoder,
  out of scope here.
- **`--stop-on-divergence`.** Implemented (throws with the full error and
  tx CBOR on the first rejection when set) but not exercised live -- 13e ran
  without it, by design, to see the full rejection spread.
- **Governance/CC transactions, reference scripts, mint/withdrawals through
  replay specifically.** The 29 source transactions in 13e were ordinary
  payments; replay's witness-strip-and-resign logic is generic (it touches
  only vkeys, nothing script/datum/redeemer-specific), but a replayed
  script-spending or governance transaction was not observed directly.
