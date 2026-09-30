# Fork-mode clock as a post-startup signal — test fixtures (Phase 10)

Can a running node's faked clock be changed **after** it has started, instead of
being baked into `FAKETIME` at process start? The motive is a race, not elegance:
every consumer of the process-start anchor has to guess how long the container
will take to come up, and the guess is scaled by the rate.

- Image: `ghcr.io/cryptophonic/cardano-node-ogmios:v7.0.0_11.1.2-custom-cb30ce58-faketime`
  (`sha256:d99bdaaa95e6…`), cardano-cli 11.2.3.0
- Run: `run-s1`, `CARDANO_FORK_SLOT=123372484`, `CARDANO_FORK_BLOCK_EVERY=20`,
  golden DB at chain tip slot 123372484 / block 4684177
- Real time during the run: 2026-09-30T07:29–07:36Z, i.e. the DB was ~8.4 days
  stale — far past the ~7.2 h forecast horizon, so nothing here forges by accident.

## The race being fixed

`scripts/follower-node` sets the follower's faketime target a few hundred slots
**ahead** of the forger's, because libfaketime anchors a speed-up at process
start and the follower must start second (it needs the forger's namespace to
exist). With `lead` slots of headroom at rate R, the follower's clock ends up
ahead of the forger's only while

    lead - R * (real seconds between reading the forger's position and the
                follower's libfaketime init) > 0

At the shipped `lead=400`, `R=100` buys **4 real seconds** for a `docker run`
plus image start. At `R=1000` the same lead buys 0.4 s. If it runs out the
follower's clock sits behind the chain and every block it receives looks like a
block from the future.

## 10a. libfaketime in this image supports file mode

`strings docker/libfaketime.so.1` lists, among others:

    FAKETIME_TIMESTAMP_FILE   FAKETIME_NO_CACHE   FAKETIME_CACHE_DURATION
    FAKETIME_FOLLOW_FILE      FAKETIME_SHARED     FAKETIME_FLSHM

Short-lived probe, `FAKETIME` unset, spec supplied only by the file:

    real:       Wed Sep 30 07:29:10 UTC 2026
    file set 1: Mon Sep 21 22:08:14 UTC 2026     (file: @2026-09-21 22:08:14)
    file set 2: Thu Mar  4 05:06:07 UTC 2027     (file: @2027-03-04 05:06:07)

**PASS**, and the file is re-read per process rather than baked in at image
build or container create.

### A red herring worth recording

A bash loop printing `$EPOCHSECONDS` under the same preload reported **real**
time (`1790753375` ≈ 2026-09-30) and was unaffected by rewriting the file. So
bash's `EPOCHSECONDS` is not intercepted by this build. It proves nothing about
the node either way — `fork-mode-faketime.md` T1 already established that
LD_PRELOAD does reach the GHC binary's clock calls — but it will mislead anyone
who reaches for the quickest in-process probe. Use the node.

## 10b. `FAKETIME_NO_CACHE=1` hangs cardano-node

    LD_PRELOAD=/opt/faketime/libfaketime.so.1
    FAKETIME_TIMESTAMP_FILE=/rundir/chain/faketime.stamp
    FAKETIME_NO_CACHE=1
    FAKETIME_DONT_FAKE_MONOTONIC=0

The node's clock **is** faked — its own startup trace reads
`"at":"2026-09-21T22:08:25.5298437Z"` against a real clock of
2026-09-30T07:32Z. But it then stops:

    log lines: 3 (last is Reflection.TracerInfoConfig)
    cpu=0.00%  mem=1.735GiB
    no progress over 30 s; no "Chain extended" in 4 minutes

Zero CPU rather than 100% — it is blocked, not thrashing. `NO_CACHE` makes
libfaketime re-read the file on **every** clock call, and a GHC runtime calling
`clock_gettime` from many threads does not survive it. Do not use `NO_CACHE`
with the node.

## 10c. `FAKETIME_CACHE_DURATION=2` works, at full rate and full cadence

Same file, `FAKETIME_NO_CACHE` replaced by `FAKETIME_CACHE_DURATION=2`.

Effective rate, measured from the node's own log timestamps on consecutive
`Chain extended` lines against the real clock:

    sample 1  faked 2026-09-22 00:06:20.2425   real 1790753725
    sample 2  faked 2026-09-22 00:56:20.2376   real 1790753755
    -> faked advanced 3000.0 s over 30 s real  =  x100.0

Cadence over 819 blocks:

    gap  20  x813
    gap  40  x2
    gap  60  x1
    gap  80  x1
    gap 100  x1          <- the jump in 10d
    median gap 20

`NoLedgerView` / `CurrentSlotUnknown` / `BlockFromFuture`: **0**.

So file mode is not a compromise: x100.0 against env-var mode's measured 96.4x
(`fork-mode-rate-and-epoch.md` 9a), and 813/819 exact gaps against that arm's
944/951.

## 10d. Rewriting the file moves a RUNNING node's clock

With the node forging, the stamp was rewritten in place from
`@2026-09-21 22:08:14 x100` to `@2026-09-21 22:41:34 x100` — the anchor
advanced by 2000 s. No restart, no SIGHUP, nothing sent to the container at all;
the file simply changed under it.

The clock moved. The single 100-slot cadence gap above is that moment. Measured
~25 real seconds later the tip had advanced 320 slots where an unchanged clock
predicts 2500, which at first reading looks like a collapse — it is not, it is a
stale-log artifact of comparing a `Chain extended` line's slot against a fresher
clock sample.

Sampling clock and tip from the **same** log line settles it:

    clock_slot=123385040  tip=123385040  gap=0
    (40 s real later)
    clock_slot=123389040  tip=123389040  gap=0

4000 slots in 40 real seconds, and the tip exactly on its own clock. The node
absorbed the forward jump and returned to zero lag.

**PASS.** The clock is a signal, not an immutable property of the process.

## 10e. Two nodes synchronised by writing both stamps after startup

The point of the exercise. `run-s1` forging at x100 in file mode, `run-s1-follower`
started afterwards in the forger's namespace, both in file mode, and the
follower given **no lead at all** — the same anchor as the forger, which is the
case the shipped `lead` exists to avoid.

### The race, measured rather than estimated

Container start times, from `docker inspect -f '{{.State.StartedAt}}'`:

    devnet-node-isolated  2026-09-30T07:43:16.81992314Z
    devnet-node-follower  2026-09-30T07:43:38.395169041Z

**21.575 real seconds** of launch skew, which at x100 is **2157 slots**. The
shipped `FOLLOWER_LEAD_SLOTS=400` cannot cover it. Observed skew agreed:

    forger    clock 2026-09-21 23:34:21   tip 123377660
    follower  clock 2026-09-21 22:58:43   tip 123375520

2138 slots of clock skew, 2140 of tip gap — the follower cannot accept a block
newer than its own clock, so it sat exactly as far behind as its clock did. The
symptom is not a clean error: **346 `Net.PeerSelection.Selection.DemoteLocalAsynchronous`**
warnings, i.e. it thrashed the connection to the one peer it has.

### A rewrite RE-ANCHORS the multiplier — the formula that matters

First correction attempt used `forger_anchor + skew`, i.e. moved the anchor
forward by the measured 2138 slots plus margin. **It made things worse** (tip gap
2140 -> 5040). Because in file mode the speed-up is re-anchored at the moment the
file is read, not at process start:

    clock_after_rewrite  ≈  new_anchor + rate * (t - t_rewrite)

so writing a *larger anchor* throws the clock back to near that anchor instead of
adding to where the clock already was. The follower's clock went
22:58:43 -> ~22:44:52 and climbed again from there.

The correct correction is therefore simpler than skew arithmetic: write the
**forger's current faked clock** plus a margin. No knowledge of launch times, no
rate multiplication, nothing to get wrong.

    follower_anchor  =  forger's current clock + margin

### Result

Anchor set to the forger's live clock + 100 slots:

    tip gap  5040 -> 40 slots   (2 blocks)
    clocks within 29 s
    follower's last blocks are the forger's exact hashes:
      53369c83…:123392960 and 3b4a63c6…:123392980 in both

313 of a 400-block sample identical by `hash:slot`; the 87 that differ are older
blocks outside the forger's sample window, not divergence.

### The margin is not cosmetic

At +100 slots the follower stayed 2 blocks behind and churned at ~16/s. Raising
the margin to +600:

| margin | tip gap | DemoteLocalAsynchronous |
| --- | --- | --- |
| +100 slots | 40 slots | ~16/s |
| +600 slots | **0 slots** | **~0.9/s** |

At +600 the follower's clock ran ~295 s ahead of the forger's — the safe
direction, and the ordinary case for any follower.

**PASS.** Two nodes can be synchronised after they are both up, from a single
observable (the forger's own log clock), with no dependence on how long either
container took to start.

### What this does not settle

- The residual ~0.9/s churn at +600 is unexplained. It does not prevent sync
  (gap 0, hashes identical) but it is not nothing, and it was not compared
  against a non-accelerated run or against the env-var arm.
- The margin was tuned on two data points on one host. It is a headroom figure,
  not a derived constant.
- The forger's clock was read from its last `Chain extended` line, which is
  current only because a forger emits one every `BLOCK_EVERY` slots. That is not
  a general way to read any node's clock — a quiet node's last line is stale, and
  a short-lived child process is useless for this because it re-anchors.

## Limits of this evidence (10a-10d)

- The jump tested was **2000 slots**, ~20 real seconds at x100 and well inside
  the ~7.2 h forecast horizon. A jump large enough to clear the horizon is
  exactly what `NoLedgerView` is for and was **not** tested here. The tip still
  has to advance through a warp; this changes only whether a restart is needed
  to move the clock, not whether the chain can skip ahead.
- Whether `FAKETIME_CACHE_DURATION` counts real or faked seconds was not
  determined. At x100 a 2-unit window is either 2 s or 20 ms of real time, and
  both worked here; it matters for how promptly a rewrite is picked up.
- Only `CACHE_DURATION=2` was tried. The default (10) and the shared-memory
  route (`FAKETIME_SHARED`/`FAKETIME_FLSHM`, which is how the `faketime`
  wrapper does live adjustment) are untested.
- Backwards jumps were not tested.

## What this means for the tooling

- `set-faketime` should write a stamp file and point `FAKETIME_TIMESTAMP_FILE`
  at it, rather than writing `FAKETIME` into `faketime.env`. The run directory
  stays the single record of the clock either way.
- `follower-node` can stop guessing a lead. Start the follower, then write its
  stamp from the forger's *actual* position once both are up. The race
  disappears rather than being padded against.
- `devnet fork warp` does not need a stop/restart to change the clock, so it
  does not need to reissue the opcert around a restart either. It still has to
  let the tip advance through the target.
