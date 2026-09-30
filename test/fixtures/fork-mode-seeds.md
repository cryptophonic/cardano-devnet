# `devnet fork seeds` — test fixtures (Phase 12 / Step 4)

Gives a fork a handful of known-funded test addresses without scanning its UTxO
set: a short, checked-in candidate list gets verified against the fork's own
live ledger, and the funded ones land in `manifest.json`. Records that the
verification survives the same large-lovelace trap fixture 11b found, and one
unrelated lifecycle snag hit while setting this fixture up.

- Image:
  `ghcr.io/cryptophonic/cardano-node-ogmios:v7.0.0_11.1.2-custom-cb30ce58-faketime`
- node 20.20.2
- Run: `run-sdk1` (the same fork fixture 11 used), fork slot 123372484
- Candidates: `config/fork-seed-candidates/preview.json`, one entry -- the
  whale address every fork-mode fixture since the god-key phase has used
  (`addr_test1vp8cprhse9pnnv7f4l3n6pj0afq2hjm6f7r2205dz0583egagfjah`)

## 12a. Verifying a candidate does not need a chain scan

`devnet fork seeds sdk1` runs one targeted `cardano-cli query utxo --address
<addr> --output-json` per candidate against the fork's own socket -- not a
`query ledger-state`, which is the operation that cost this host its memory in
fixture 11e. Output:

    whale      addr_test1vp8...: funded, 3fefb813d9...#1 (22767613730764044 lovelace)
    1/1 candidate(s) funded; written to /mnt/cardano/runs/run-sdk1/manifest.json

`manifest.json` gained:

```json
"seeds": [
  {
    "address": "addr_test1vp8cprhse9pnnv7f4l3n6pj0afq2hjm6f7r2205dz0583egagfjah",
    "role": "whale",
    "utxo": "3fefb813d906b78c3e18535869ee706b965f5eed5969e112a4d2d99a0ffa9d8b#1",
    "lovelace": "22767613730764044"
  }
]
```

A candidate with no funds is dropped rather than recorded empty; the command
fails only if *none* of the candidates are funded.

## 12b. The lovelace figure survives the trip that broke fixture 11b

`22767613730764044` is above `Number.MAX_SAFE_INTEGER`. `lovelace` is written
into `manifest.json` as a **string** deliberately: `src/fork/cli.mjs`'s
`readManifest()` is a plain `JSON.parse`, the same call that silently rounded
this address's balance in `src/devnet/components/Ogmios.mjs` before
`src/fork/ogmios.mjs` was written to work around it. On the write side,
`cmd_seeds`' python helper reads cardano-cli's own JSON with the stdlib `json`
module, which parses an integer literal to an arbitrary-precision `int` --
no `Number` involved on that side at all -- and stringifies it before it ever
reaches `manifest.json`.

`Fork.seed(role)` converts it back with `BigInt(found.lovelace)`:

    seed(): addr_test1vp8... bigint 22767613730764044n

Exact, both directions.

## 12c. The SDK surface

`fork.seed('whale')`, `fork.impersonateSeed('whale')` and `fork.extractSeeds()`
(the JS wrapper around the CLI command) all round-trip against `run-sdk1`:

    seed(): addr_test1vp8... bigint 22767613730764044n
    impersonateSeed() -> 17 utxos, address addr_test1vp8...
    seed() correctly throws for an unknown role

`test/fork-sdk-impersonate.mjs` now sources its victim from
`fork.manifest.seeds` when present (falling back to the hardcoded constant it
used before Step 4, for a fork that predates this), and the full impersonation
property from fixture 11c still holds end-to-end through that path -- same
witness-set / stock-rejection / fork-acceptance sequence, this time initiated
from a seed lookup rather than a pasted address.

Re-running `extractSeeds()` after that spend picked up the whale's *new*
change output (`6e15ddedd6...#1`, the tx that spend created) rather than the
now-gone one -- seeds are a live snapshot, refreshed by re-running the
command, not a durable claim about what is still spendable.

## 12d. Unrelated snag: a stopped stamp-mode fork's clock does not remember its own tip

`run-sdk1` had advanced to slot 123443730 (block 4755423) during fixture 11's
work, real time under `blockEvery 1`, rate x1. Stopping and restarting it for
this fixture reproduced:

    Forge.Loop.BlockFromFuture: Couldn't forge block because current tip is in
    the future: current tip slot: 123443730, current slot: 123373458

The container's `chain/faketime.stamp` still held the anchor written at
`create` time; nothing had re-anchored it to where the chain actually got to
before the previous stop. The node's own ChainDB tip is therefore *ahead* of
what its faked clock believes "now" is, and it refuses to forge until the
clock catches up -- which it never will on its own, since nothing advances the
stamp without a command that writes one.

**Not a `seeds` bug** -- `query utxo` answered correctly throughout, since a
state query reads the ChainDB as loaded, independent of `BlockchainTime`. It
only blocks forging, so it would only bite something that needs the fork to
keep producing blocks after a stop/start cycle.

Fixed with the existing rate machinery, run live: `devnet fork rate sdk1 2`
resynced the stamp to `live_tip_slot`'s reading (the real ChainDB tip) as a
side effect of the rate write, and forging resumed immediately. A same-rate
`devnet fork rate` is a deliberate no-op (`fork-mode-clock-signal.md` 10d:
a needless stamp write can move the clock backwards), so recovering from this
needs an actual rate change, however small, not a re-issue of the same one.

Worth a follow-up: `devnet fork start` could compare the stamp's implied slot
against the ChainDB's own tip at startup and warn (or offer to resync) rather
than silently forging nothing until someone notices.
