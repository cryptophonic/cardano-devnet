# `devnet fork seeds` and `generate` — test fixtures (Phase 12 / Step 4)

**Supersedes an earlier version of this file.** The first cut of "Step 4" (a
small checked-in candidate-address list, verified with one targeted query per
address) was built from a one-line hint in `scripts/devnet-fork` without
having read `fork-mode-prompts.md`, the actual master plan for this work. That
plan's real Step 4 is **`generate` (synthetic load)**, with seed extraction as
a prerequisite sub-step -- and specified very differently: a full
`--whole-utxo` scan, streamed to disk, never loaded into a process at once.
This file replaces the old write-up with what Step 4 actually is.

- Image:
  `ghcr.io/cryptophonic/cardano-node-ogmios:v7.0.0_11.1.2-custom-cb30ce58-faketime`
- cardano-cli 11.2.3.0 (git rev `fef83fed`), jq 1.6, node 20.20.2
- Run: `run-sdk1`, fork slot 123372484

## 12a. Preview's `--whole-utxo` is not small

Measured 2026-09-30: `cardano-cli query utxo --whole-utxo --output-json`
against `run-sdk1` produced **2.9 GB / 3,192,387 UTxOs** in 3m30s wall time.
cardano-cli's own `--help` calls `--whole-utxo` "only appropriate on small
testnets" -- preview, after years of public use, no longer qualifies.

`docker stats` during the dump:

    devnet-fork-sdk1 (the node)   1.8 -> 3.7 GiB   (roughly doubled, bounded)
    the throwaway cli container   ~300 MiB          (streams to --out-file)

Bounded and temporary on both sides -- not the runaway, unbounded
`query ledger-state` failure mode fixture 11e already established. The
dump itself was never the risk here; parsing the result back was.

## 12b. Two ways to corrupt the result, both found before they shipped

1. **`json.load()` on the raw file.** Would try to materialize a Python
   object graph for 3.19M entries at once -- exactly what "never load it into
   a process at once" rules out.
2. **jq is not a safe substitute.** Tried first, since it can `--stream` a
   huge document without building the whole tree:

       $ echo '{"a":{"v":9007199254740993}}' | jq -c --stream 'fromstream(1|truncate_stream(inputs))'
       {"v":9007199254740992}

   jq 1.6 silently rounds any integer above 2^53 through its internal double
   -- the *exact* failure mode fixture 11b found in `JSON.parse`, one layer
   further down the pipeline, in a tool that was supposed to be the safe
   alternative to writing a parser by hand.

The extractor (`extract_seeds()` in `scripts/devnet-fork`) is hand-written
instead: a compiled regex finds each top-level `"<txhash>#<ix>":` key (the
key shape is fixed and regular), and `json.JSONDecoder.raw_decode` -- the
stdlib's own C-accelerated scanner -- reads just that one entry's value off a
small rolling buffer. Python's `int` is exact at any size, so precision
survives; memory is bounded by one read chunk plus whatever passes the
filter, never by the size of the whole dump.

## 12c. A second bug, found by measuring rather than assuming: the cap kept the wrong entries

First run, default threshold 10,000 ADA:

    scanned 3192387 utxo(s); 20000 qualify (>= 10000 ADA, key-hash payment,
    no datum/script) -- hit the 20000-entry safety cap

Over 20,000 addresses on preview hold >= 10,000 ADA -- the threshold was
useless as a filter. Worse: the safety cap was first-come-first-served over
`--whole-utxo`'s (unsorted) key order, so it kept an *arbitrary* 20,000 of the
qualifying entries, not the *biggest* 20,000. `Fork.seed(0)` promises "the
biggest seed"; a first-come cap does not guarantee that at all -- the true
top entry could easily have been scanned after the cap already filled.

Fixed with a bounded min-heap (`heapq`) of the `SAFETY_CAP` biggest entries
seen so far, correct regardless of scan order. Recalibrated the default
against the real distribution instead of guessing again:

    min_ada=100000:    qualifying=1428
    min_ada=1000000:   qualifying=639
    min_ada=10000000:  qualifying=43

`DEFAULT_SEED_MIN_ADA` is now **1,000,000 ADA** -- comfortably under the cap,
big enough to exclude the long tail of small test wallets, small enough to
leave `generate` plenty of round-robin room. Final run with the fix:

    scanned 3192387 utxo(s); 639 qualify (>= 1000000 ADA, key-hash payment, no datum/script)
    written to /mnt/cardano/runs/run-sdk1/seeds.json (indexed in manifest.json)

`seeds.json[0]` is the same whale every fork-mode fixture since the god-key
phase has used (`22767612730598191` lovelace, exact -- above
`Number.MAX_SAFE_INTEGER`, stored as a JSON string for the same reason as
everywhere else in this SDK, fixture 11b). `manifest.json.seeds` is a
**summary only** (`{file, count, minAda, extractedAt}`), not the array
itself -- 639 entries (or however many a lower threshold finds) does not
belong embedded in the manifest the way the old ~1-entry version did.

## 12d. The SDK and CLI surface

`fork.seeds` (getter, reads `seeds.json`, `lovelace` as `BigInt`),
`fork.seed(n = 0)` (rank-indexed, 0 = biggest), `fork.impersonateSeed(n)`,
`fork.extractSeeds(opts)` (wraps `devnet fork seeds`). `test/fork-sdk-
impersonate.mjs` sources its victim from `fork.seed()` when `manifest.seeds`
exists, falling back to its old hardcoded constant otherwise -- same address,
verified full impersonation property still holds end-to-end (12e).

## 12e. `devnet fork generate` -- real synthetic load, end to end

    $ devnet fork generate sdk1 --tps 2 --duration 5 --shape mixed
    generating mixed load on 'sdk1': 2 tps for 5s (10 tx, 639 seed(s) available)
      ok      addr_test1vp8cprhse9pnnv7f4l3n...  94dee1c8...
      ok      addr_test1qr7x242ay92hynzt6tj4...  40eab7a6...
      ok      addr_test1vp8cprhse9pnnv7f4l3n...  d14698f8...
      REJECT  addr_test1vp8cprhse9pnnv7f4l3n...  ogmios submitTransaction error 3997...
      ...
    requested 10  submitted 10  accepted 7  rejected 3
    observed 1.97 blocks/s at rate x2 (blockEvery 1), 12722ms wall

7 real, signed, god-key-witnessed transactions landed on the fork (confirmed
by the rising block count, not just mempool acceptance); `mixed` alternated
`transfer` (to the fork's own producer address, same convention as the
impersonation fixture) with `fanout` (a freshly generated `addr_test1...`
enterprise address per tx, built from a random 28-byte KeyHash credential --
nobody holds its key, which is fine, it only needs to be a valid sink).

**The 3 rejections are the known, documented limitation, not a bug**: every
tick queries `getUnspentOutputs()` live rather than tracking a local UTxO
model, so an address can be handed a now-already-spent input if it comes up
again in the rotation before its previous transaction confirms. Here it
happened because the whale address holds *two* different UTxOs that both
made the top-10 seed list, so round-robin picked "the whale" twice within the
same ~2-second window although the two picks were different array indices.
The ledger error came back verbatim, exactly as `fork-mode-prompts.md`
specifies for Step 5's replay ("a rejection is the product, not a bug") --
applied here a step early, since `generate` hits the same class of race.

**Known simplification, not fixed here:** a proper local UTxO ledger (marking
an address's input spent and its own change output available the instant a
transaction is *built*, rather than re-querying the provider) would close
this race and let `generate` sustain much higher TPS against a small seed
set. Left as a documented gap; round-robin across many distinct seed
addresses is the mitigation in place.

## What this does not establish

- **`fanout`/`mixed` at scale.** Exercised for 10 total transactions, not a
  sustained run; fanout addresses are pure sinks, never spent from again.
- **Chaining past a seed's original balance.** Every seed here has far more
  than one tick's worth of ADA; a run long enough to actually exhaust a
  seed's original UTxO and spend its own change was not attempted.
- **A rate-scaled report note.** `generate`'s report shows the fork's current
  rate/blockEvery but does not itself explain the mempool-timeout scaling
  from Phase 9 -- that machinery already exists in `cmd_rate`/`cmd_create`,
  `generate` just inherits it.
