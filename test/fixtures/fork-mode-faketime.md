# libfaketime clock-shifting — test fixtures

Whether `LD_PRELOAD`'d libfaketime reaches the GHC-compiled cardano-node
binary's clock calls (x86-64 usually resolves `clock_gettime` through the
vDSO, bypassing the PLT and any `LD_PRELOAD`), and whether shifting the
container clock fixes a fork-mode node's inability to forge against a stale
DB once real time has drifted past the ledger's forecast horizon
(`NoLedgerView` / `CurrentSlotUnknown`).

- Image: `devnet-node-faketime:cb30ce58`, a local `docker build -f
  docker/Dockerfile .` of the fork-mode node with `docker/libfaketime.so.1`
  added (see `scripts/build-faketime`).
- `libfaketime.so.1`: `nix build nixpkgs#libfaketime` on the host (glibc
  2.42-84), RPATH-patched via `patchelf --set-rpath` to the image's own glibc
  (`/nix/store/jms7zxzm7w1whczwny5m3gkgdjghmi2r-glibc-2.42-51/lib`) — one
  glibc in the process, not two.
- Runs: `run-14` (T1, gates unset), `run-15` (T2/T3,
  `CARDANO_FORK_SLOT=123372484`, `CARDANO_FORK_BLOCK_EVERY=5`), all reflink
  clones of the golden DB at tip slot `123372484` (2026-09-21T22:08:04Z).
  `systemStart = 2022-10-25T00:00:00Z`, `slotLength = 1`, so slot N is exactly
  N seconds after systemStart on preview — verified independently against a
  real-clock run and a faked-clock run.

## T0 — does libfaketime load at all in the container

    docker run --rm -e LD_PRELOAD=/opt/faketime/libfaketime.so.1 \
      -e FAKETIME='-96h' --entrypoint /bin/sh devnet-node-faketime:cb30ce58 \
      -c 'date -u'
    → Fri Sep 18 00:39:34 UTC 2026   (real: Tue Sep 22 00:39:33 UTC 2026)

**PASS.** Also confirmed with the absolute form, `FAKETIME='@2026-09-01
12:00:00'` → `Tue Sep  1 12:00:00 UTC 2026`. Notably this is nix-built
coreutils linked against the same glibc as the node — not a distro binary —
so T0 alone doesn't yet say anything about the vDSO question.

## T1 — does it reach the GHC binary (the decisive test)

cardano-node started under `FAKETIME='-96h'`. Real time at start:
`2026-09-22 00:40:33Z`.

    {"at":"2026-09-18T00:40:33.687781049Z","ns":"Reflection.TracerInfo",...}
    ...
    Forge.Loop.BlockFromFuture: current tip slot: 123372484, current slot: 123036050

The tracer's own `at` timestamp is shifted by exactly −96h, and — more to the
point — `BlockchainTime`'s slot derivation moved with it (123036050 is
precisely the faked wall-clock time expressed as a slot number).

**PASS.** LD_PRELOAD reaches GHC's clock calls; the vDSO does not bypass it
for this binary. Confirmed the `.so` is actually mapped in (not silently
ignored) via `/proc/1/maps` inside the running container:

    76182b18b000-76182b18e000 r--p 00000000 00:38 1346074   /opt/faketime/libfaketime.so.1

## T2 — does it fix the symptom

Same run-15 DB (tip 123372484), two faked-clock values bracket the ~7.2h
forecast horizon:

- `FAKETIME='@2026-09-22 22:08:04'` (tip **+24h**, past the horizon):
  `Forge.Loop.NoLedgerView: Could not obtain ledger view for slot …` every
  slot, 0 blocks forged in 45s.
- `FAKETIME='@2026-09-21 22:08:14'` (tip **+10s**): forged at slots
  `123372510, 515, 520, 525, 530, 535, 540, 545, 550…` — exactly
  `CARDANO_FORK_BLOCK_EVERY=5` apart — with zero `NoLedgerView` /
  `CurrentSlotUnknown` / `BlockFromFuture`.

**PASS.** Note the horizon failure surfaces as `Forge.Loop.NoLedgerView`, not
`CurrentSlotUnknown` — same root cause (ledger can't forecast past ~3k/f from
the tip), different tracer; worth grepping for both.

One correctness gotcha found here: the run's opcert must be issued at the KES
period covering the FAKED clock, not real now. `scripts/new-isolated-run`
computed the period from real time and issued at 952; the faked clock sat in
951, and the node rejected the opcert as future-dated until it was reissued
at 951. `new-isolated-run` now takes a `FORK_NOW` override for exactly this.

## T3 — restart across a real-time gap

Stopped run-15 at faked `2026-09-21 22:09:25Z` / slot `123372565`, real clock
`2026-09-22 00:44:21Z`. Waited 5 real minutes. Recomputed the offset from the
stopped container's own last `Chain extended` line
(`scripts/set-faketime <run dir>`, no `--slot`) and restarted with
`FAKETIME='@2026-09-21 22:09:35'`.

    Chain extended, new tip: ... at slot 123372595   (was 123372565 at shutdown)
    Chain extended, new tip: ... at slot 123372600
    ...

`cardano-cli query tip` afterwards: slot 123372635, block 4684198, epoch
1427, Conway, 99.99% synced. Zero `NoLedgerView` / `CurrentSlotUnknown` /
`BlockFromFuture` across the restart.

**PASS.** Resumed on the same chain, same 5-slot cadence, no gap-related
failure.

## The working invocation (manual `docker run` form; `scripts/isolated-node`
## + `docker-compose.yml` wire the same three env vars automatically)

    docker run -d --network none --user "$(id -u):$(id -g)" \
      --env-file <run dir>/chain/fork.env \
      -e LD_PRELOAD=/opt/faketime/libfaketime.so.1 \
      -e FAKETIME='@2026-09-21 22:09:35' \
      -e FAKETIME_DONT_FAKE_MONOTONIC=1 \
      -v <run dir>:/rundir -v <run dir>/ipc:/ipc \
      --entrypoint /usr/local/bin/cardano-node devnet-node-faketime:cb30ce58 \
      run --config /rundir/chain/config.json ...

`FAKETIME_DONT_FAKE_MONOTONIC=1` matters: only `CLOCK_REALTIME` should shift,
so consensus timers (which read `CLOCK_MONOTONIC`) stay sane. Verified the
`@` absolute form advances normally under it (log timestamps tick 1s/s, not
frozen).

## Repo integration

- `docker/Dockerfile` — `COPY`s `docker/libfaketime.so.1` (gitignored build
  artifact, same convention as `bin/cardano-node`) to
  `/opt/faketime/libfaketime.so.1`. Inert unless a service sets `LD_PRELOAD`.
- `scripts/build-faketime` — produces that artifact: builds libfaketime via
  host nix, discovers the base image's own glibc store path (the
  `/nix/store/*-glibc-2.*` entry containing `lib/libc.so.6`), patches the
  RPATH to match.
- `scripts/set-faketime <run dir> [--slot N | --clear]` — writes/clears
  `<run dir>/chain/faketime.env` from a stopped run's own last logged tip (or
  an explicit slot for a from-scratch run).
- `scripts/isolated-node` — picks up `<run dir>/chain/faketime.env`
  automatically on `start`, same pattern as `fork.env`.
- `docker-compose.yml` (`cardano-node-isolated`) — `env_file` list of
  `fork.env` + `faketime.env`; `FAKETIME_DONT_FAKE_MONOTONIC=1` set
  unconditionally as a plain `environment:` entry (harmless no-op unless
  libfaketime is loaded). `LD_PRELOAD`/`FAKETIME` come ONLY from
  `faketime.env`, never duplicated in `environment:` — Compose's
  `environment:` overrides `env_file:` for the same key, so an empty default
  there would silently blank out whatever `faketime.env` set.
- Re-verified end-to-end through this real wiring (not just manual `docker
  run`) on `run-16`: `FORK_NOW=2026-09-21T22:08:14Z scripts/new-isolated-run
  16 123372484 5` → `scripts/set-faketime run-16 --slot 123372484` →
  `scripts/isolated-node start run-16` forged at slots 123372515, 520, 525…
  with zero horizon errors.

## Published image

Rebuilt `docker/Dockerfile` with `NODE_VARIANT=custom` against the exact
`bin/cardano-node` already inside the published image (extracted via `docker
cp -L`, sha256 `cb30ce58b8f0…` — confirms the existing tag's suffix really is
that binary's sha256 prefix, per the convention noted in
`fork-mode-god-key.md`) plus `docker/libfaketime.so.1`. Node identity, cli and
ogmios all unchanged (`cardano-node 11.1.2 (fork mode)`, git rev `a3c7202d…`;
`cardano-cli 11.2.3.0`; `ogmios v7.0.0`) — only the image gained the
libfaketime layer.

Published as
`ghcr.io/cryptophonic/cardano-node-ogmios:v7.0.0_11.1.2-custom-cb30ce58-faketime`
(digest `sha256:86624237f4fd…`), re-verified against a fresh pull (not just
the local build cache): T0 (`date` under `FAKETIME='-1h'`) and a real forging
run against `run-16`'s fork gates + faketime.env both passed. This is now
`docker-compose.yml`'s and `scripts/isolated-node`'s default `DEVNET_IMAGE`.

## Regression re-check at 45 h staleness (2026-09-23) — and a published-image bug

Re-ran the clock fix against the same golden DB, now **~44 h 50 m** stale (tip
slot `123372484` = 2026-09-21T22:08:04Z; real now 2026-09-23T18:57Z) — ~6×
past the ~7.2 h horizon, a stronger case than T2's tip+24 h arm.

### Control: real clock, 45 h stale — `run-17`

`new-isolated-run 17 123372484 20`, no `faketime.env`. Over 2 min:

    BlockchainTime.CurrentSlotUnknown: Too far from the chain tip to determine
    the current slot number for the time 2026-09-23 18:59:55… UTC

0 blocks forged, `Chain extended` = 0. Note the tracer here is
`BlockchainTime.CurrentSlotUnknown` (once a minute), **not** the
`Forge.Loop.NoLedgerView` T2 saw at +24 h: past ~45 h the node cannot even map
wall-clock to a slot, so leadership checks never start. Both symptoms are the
same root cause; grep for both.

### The published image was broken for non-root — `run-18`

First faketime attempt failed at the dynamic linker:

    ERROR: ld.so: object '/opt/faketime/libfaketime.so.1' from LD_PRELOAD
    cannot be preloaded (cannot open shared object file): ignored.

…and the run then behaved exactly like the control. Cause: in
`ghcr.io/…-faketime` (digest `sha256:86624237f4fd…`), `/opt/faketime` had mode
**`drw-r--r--`** — no search bit:

    drw-r--r-- 2 0 0 4096 Sep 22 01:09 /opt/faketime
    -rw-r--r-- 1 0 0 74560 libfaketime.so.1

`COPY --chmod=0644 docker/libfaketime.so.1 /opt/faketime/libfaketime.so.1`
applies the mode to the **implicitly created parent directory** as well. Root
traverses a 0644 directory anyway (`CAP_DAC_OVERRIDE`), so `docker run`-as-root
smoke tests pass; the container runs as an ordinary uid
(`user: $MY_UID:$MY_GID`), which cannot, and `ld.so` only *warns* before
continuing without the preload. The local `devnet-node-faketime:cb30ce58`
image that T0–T3 were run against was built before the `--chmod` was added and
has `drwxr-xr-x`, which is why the original pass was real but the published
image did not carry it.

Fix: `COPY --chmod=0755` (also the conventional mode for a shared object).
Rebuilt, verified as a **non-root** uid:

    $ docker run --user $(id -u):$(id -g) -e LD_PRELOAD=… -e FAKETIME='-96h' … date -u
    Sat Sep 19 19:05:00 UTC 2026   (real: Wed Sep 23 19:05:00 UTC 2026)

exactly −96 h. `ls -ld /opt/faketime` → `drwxr-xr-x`. Node/cli identity
unchanged (`cardano-node 11.1.2 (fork mode)`, git rev `a3c7202d…`; `cardano-cli
11.2.3.0`). **The ghcr tag has NOT been re-pushed** — the local tag now points
at the fixed build (`sha256:542a73ebaede…`) while the registry still serves the
broken `sha256:86624237f4fd…`. Republish before anyone pulls it fresh.

### The fix, re-verified — `run-19`

`FORK_NOW=2026-09-21T22:08:14Z new-isolated-run 19 123372484 20` (opcert at KES
period **951**, the faked period — real now is 953) →
`set-faketime run-19 --slot 123372484` → `isolated-node start`:

    Chain extended … at slot 123372504, 524, 544, 564, 584, 604, 624, 644, 664, 680…

19 blocks over a 6-minute window, exactly `BLOCK_EVERY=20` apart, **0**
`NoLedgerView` / `CurrentSlotUnknown` / `BlockFromFuture`. `query tip` through
the run's socket: slot 123372860, block 4684195, epoch 1427, Conway.

**PASS at 45 h staleness**, once the image actually carries a loadable
libfaketime.

### Republished image verified (2026-09-23)

The tag was rebuilt and re-pushed from another machine off the committed
Dockerfile. Verified here from a **fresh pull**, not the local build:

- digest `sha256:d99bdaaa95e6…` (the broken one was `sha256:86624237f4fd…`)
- `/opt/faketime` → `drwxr-xr-x`, `libfaketime.so.1` → `-rwxr-xr-x`
- T0 as a non-root uid: `FAKETIME='-96h'` → `Sat Sep 19 19:30:18 UTC 2026`
  against real `Wed Sep 23 19:30:18 UTC 2026`, exactly −96 h, no `ld.so`
  warning
- contents byte-identical to the host artifacts:
  `libfaketime.so.1` `ac121a28c844…`, `cardano-node` `cb30ce58b8f0…` (matches
  the tag's suffix); `cardano-node 11.1.2 (fork mode)` rev `a3c7202d…`,
  `cardano-cli 11.2.3.0`, `ogmios v7.0.0 (b3a830a1)` all unchanged
- `run-20`, a fresh clone of the same still-45 h-stale golden DB: forged at
  slots 123372520, 540, 560, 580, 600, 620, 640, 660, 680 — 9 blocks at the
  20-slot cadence, 0 preload warnings, 0 `NoLedgerView` /
  `CurrentSlotUnknown` / `BlockFromFuture`. `query tip`: slot 123372680,
  block 4684186, epoch 1427, Conway.

The registry now serves a working image.
