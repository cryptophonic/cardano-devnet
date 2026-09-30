# The fork SDK — test fixtures (Phase 11 / Step 3)

A fork driven from JavaScript rather than from the shell: an ogmios sidecar per
fork, a Blaze provider on top of it, and impersonation as a signer. Records what
the SDK establishes that the earlier phases did not, and one ledger-adjacent trap
that only appears once a real chain's balances meet a JSON parser.

- Image:
  `ghcr.io/cryptophonic/cardano-node-ogmios:v7.0.0_11.1.2-custom-cb30ce58-faketime`
  (`sha256:d99bdaaa95e6c45fe0a748ec380ebd8eee0825aa7a73bf6602928e559aa5f5db`)
- ogmios `v7.0.0 (b3a830a1)`, from the same image
- cardano-cli 11.2.3.0, git rev `fef83fed` (stock, on the host)
- node 20.20.2; `@blaze-cardano` sdk 0.2.22, query 0.3.5, core 0.6.1, wallet 0.3.11
- Run: `run-sdk1`, created 2026-09-30 by `devnet fork create --name sdk1
  --network preview --from db:/mnt/cardano/preview`
  - `CARDANO_FORK_SLOT=123372484` (the golden DB's own chain tip, block 4684177,
    `18671538fe50f4ec0ac452053c05158a5c4827d0f31e73881804f5af055aad14`; in the
    volatile range, so no truncation)
  - `CARDANO_FORK_BLOCK_EVERY=1`, rate x1, clock stamped `@2026-09-21 22:08:14`
  - god key `868e39685a4c0a57aeb579ce30edec4daaf49cf62a5cd055f9b8a06b`
- Impersonated whale, keys not held:
  `addr_test1vp8cprhse9pnnv7f4l3n6pj0afq2hjm6f7r2205dz0583egagfjah`
  (payment key hash `4f808ef0c94339b3c9afe33d064fea40abcb7a4f86a53e8d13e878e5`)

## 11a. A fork is reachable from a client without publishing anything

`devnet fork ogmios start sdk1` runs a second container, `devnet-fork-sdk1-ogmios`,
from the same image:

    /bin/ogmios --host 0.0.0.0 --node-socket /ipc/node.socket \
                --node-config /rundir/chain/config.json

mounting the fork's own run directory. It reaches the node over the Unix socket in
`<run>/ipc`, so the node keeps `network_mode: none` and the phase-8 isolation
property is untouched — the sidecar has a network, the node still has none.

The sidecar publishes no host port either. It joins a shared bridge,
`devnet-forks`, and is addressed there:

    ogmios ready: ws://172.22.0.2:1337  (container devnet-fork-sdk1-ogmios, nothing published)

    $ docker inspect devnet-fork-sdk1-ogmios \
        --format 'Ports={{.NetworkSettings.Ports}} Bindings={{.HostConfig.PortBindings}}'
    Ports=map[12788/tcp:[] 12798/tcp:[] 1337/tcp:[] 3000/tcp:[]] Bindings=map[]

`Ports` lists what the image EXPOSEs, each with an empty binding list;
`PortBindings` is the one that would name a host port, and it is empty. The node
beside it is unchanged:

    $ docker inspect devnet-fork-sdk1 --format 'NetworkMode={{.HostConfig.NetworkMode}} Ports={{.NetworkSettings.Ports}}'
    NetworkMode=none Ports=map[]

`devnet fork stop` removes the sidecar before stopping the node: the sidecar is
`restart: on-failure`, so one left behind a stopped fork restart-loops against a
dead socket forever.

A client on the host routes to the bridge address directly; it cannot resolve the
container *name*, because docker's DNS is inside the bridge, so `devnet fork
ogmios url` asks docker for the name's address instead. Same addressing, a
different resolver — and one bridge for every fork rather than a host port each.

Ogmios' own `/health` answers over that address:

    {'connectionStatus': 'connected', 'currentEra': 'conway',
     'networkSynchronization': 0.99413,
     'lastKnownTip': {'slot': 123374436, 'height': 4686103, 'id': '1a5ca253...'}}

`networkSynchronization` is measured against the **real** clock, and the fork's
chain sits nine days behind it, so it reads slightly under 1 (0.994 here) and will
drift further the longer the golden DB goes without a refresh. It is not a
readiness signal and not an error; `connectionStatus` is what `devnet fork ogmios
start` waits for. Every query below answers correctly at this reading.

## 11b. Money past 2^53: the trap that a local devnet cannot show

**The finding.** A fork inherits a real chain's UTxO set, and preview's wealthiest
address holds a single output of

    54ca4d491ba4a269c806c7b545f74d56a8c3fbae18c3f1b25d95b73c0bc68490#0
    22767614730929897 lovelace

`Number.MAX_SAFE_INTEGER` is `9007199254740991`. Plain `JSON.parse` — which both
`src/devnet/components/Ogmios.mjs` and `@blaze-cardano/ogmios` use — reads that
quantity as `22767614730929896`. No error is raised anywhere. A transaction
balanced against the rounded figure is one lovelace short, and the node rejects
it:

    ConwayUtxowFailure (UtxoFailure (ValueNotConservedUTxO Mismatch (RelEQ)
      {supplied: MaryValue (Coin 22767614730929897) (MultiAsset (fromList [])),
       expected: MaryValue (Coin 22767614730929896) (MultiAsset (fromList []))}))

Observed as `Mempool.RejectedTx` / `MempoolRejectedByLedger` on the node, and as
`RejectTx` on ogmios' own websocket trace. It is a deeply unhelpful failure from
the client's side: every value the client can print agrees with itself. Re-reading
the input through ogmios and adding up the transaction it built gives
`input - (outputs + fee) = 0` — because the reading of the input is the thing that
is wrong.

This is why `src/fork/ogmios.mjs` exists rather than the SDK using the blaze
ogmios client directly: it scans the raw reply text and keeps any integer too
large for a `Number` as a string, which `BigInt()` then reads exactly. With that
in place the same transaction balances and is accepted (11c).

A local devnet never meets this — `fund` deals in hundreds of ADA. On a fork of a
real chain it is the **first** transaction you write, because coin selection
reaches for the largest UTxO first.

Worth stating plainly: the same rounding is still present in
`src/devnet/components/Ogmios.mjs`, which the local-devnet provider uses. It is
harmless at devnet balances and was left alone rather than changed under a fork
commit.

## 11c. Impersonation through the SDK: accepted by the fork, invalid under stock rules

`test/fork-sdk-impersonate.mjs`, the test Step 3 asks for. It builds a payment out
of the whale's funds with Blaze, signs with `fork.impersonate(whale)` — whose
witness set is the god key and nothing else — and checks both halves of the
property. Full output:

    fork 'sdk1'  magic 2  fork slot 123372484
    god key 868e39685a4c0a57aeb579ce30edec4daaf49cf62a5cd055f9b8a06b
    tip     slot 123373291  block 4684958  epoch 1427
    clock   slot 123373291  2026-09-21T22:21:31.000Z  x1  (forger-last-chain-extended)
    PASS  the chain has forged past the fork slot
    PASS  the impersonated address holds UTxOs            17 utxos
    PASS  the impersonated address is NOT the god key's own address
    PASS  every input belongs to the impersonated address
            54ca4d491ba4a269c806c7b545f74d56a8c3fbae18c3f1b25d95b73c0bc68490#0
    PASS  exactly one vkey witness is attached
    PASS  the one witness is the god key
    PASS  stock rules would require the victim's key
    PASS  the STOCK witness check FAILS on this witness set
            MissingVKeyWitnessesUTXOW (NonEmptySet (fromList
              [KeyHash {unKeyHash = "4f808ef0c94339b3c9afe33d064fea40abcb7a4f86a53e8d13e878e5"}]))
    PASS  and the key it says is missing is the victim's
    PASS  while the god witness is one stock rules did not ask for
    PASS  the FORK accepted it and it reached the ledger
            3fefb813d906b78c3e18535869ee706b965f5eed5969e112a4d2d99a0ffa9d8b
    PASS  the inputs it spent are gone from the impersonated address
    PASS  1000000000 lovelace landed at the destination

**No second node is involved.** The stock half is computed locally by
`src/fork/stock-witness.mjs` from the transaction and its resolved inputs: stock
Conway rules need a vkey witness for every key-hash payment credential being
spent, and the god witness is not one of them, so a stock ledger raises
`MissingVKeyWitnessesUTXOW` naming the whale. That is the same constructor and the
same shape as fixture `fork-mode-god-key.md` case D, which a real node produced.

The check also reports the god witness as `extraneous` — informational only.
Extraneous witnesses are **not** a stock failure (case B of the god-key fixture is
valid stock-side, which is exactly why the fork rejects it); the replay barrier
here is the missing one, not the surplus one.

## 11d. The clock through the SDK

`test/fork-sdk-lifecycle.mjs`, on the same run:

    tip     slot 123373364  block 4685032  epoch 1427
    clock   slot 123373364  2026-09-21T22:22:44.000Z  x1
    PASS  epoch() agrees with tip().epoch                     1427 vs 1427
    PASS  the forger's clock is not behind its own tip         clock 123373364, tip 123373364
    PASS  clock() reports the rate the manifest claims
    PASS  the manifest now records the new rate                x4
    PASS  the clock did not go backwards over the rate change  123373364 -> 123373365
    PASS  and clock() reports the new rate
    PASS  the chain reached the target slot                    123373445 >= 123373425
    PASS  and forged blocks getting there                      block 4685032 -> 4685112
    PASS  the manifest's warpTarget was cleared once it arrived
    PASS  warping backwards is refused
    PASS  warpTo({ slot, epoch }) is rejected

Two things this pins down:

- **`fork.now()` is the forger's clock, not a clock.** There is no cheap general
  source: under libfaketime a child process re-anchors the multiplier and reports
  the bare anchor, so no subprocess can be asked. The only honest observable is
  the forger's own log timestamps, which is what `devnet fork clock` reads and why
  its JSON names its source `forger-last-chain-extended`. It is producer-only, and
  stale in proportion to the cadence — at `blockEvery 1` and x1 it is a second
  behind; at x100 it is further.
- **A rate change does not move the clock backwards.** x1 -> x4 at slot 123373365
  left the clock at 123373365, not behind it. A stamp write re-anchors the
  speed-up at the moment the node reads the file, so writing "the clock is the
  current tip, now" is safe; writing an offset would not be.

`60 slots at x4 = 15 real seconds` was predicted and ~20 observed, the difference
being the poll interval — a warp still forges through the distance rather than
skipping it, unchanged from Step 2.

## 11e. Two forks, two sidecars, one bridge, one client

`sdk2` created from the same golden DB with an explicit `--slot 123372484`, started
beside `sdk1`, each with its own ogmios:

    sdk1  ws://172.22.0.2:1337  tip slot 123375130 block 4686797 epoch 1427
    sdk2  ws://172.22.0.3:1337  tip slot 123372522 block 4684189 epoch 1427
    distinct chains: true

One node process reached both, by name resolved through docker, over the one
`devnet-forks` bridge. Neither node has a network namespace; neither sidecar
publishes a port. Two ogmios containers plus two preview nodes fit in this host's
16 GB, but only just -- see the memory note below.

`test/fork-sdk-impersonate.mjs sdk2` passes identically, and reproduces the **same
transaction id** as the sdk1 run, `3fefb813d906b78c3e18535869ee706b965f5eed5969e112a4d2d99a0ffa9d8b`:
same fork point, same coin selection, same fee, so the transaction body is
byte-identical. The same determinism the god-key fixture's case E showed.

A fork created with an explicit `--slot` in the volatile range records
`fork.hash: null` (the hash at the fork slot is not recoverable once the run has
forged past it), and the SDK does not need it -- everything above works on sdk2
with a null hash.

**Memory.** The tip probe `create` runs to default the fork slot is a full node on
a throwaway clone. Started while `sdk1` and its sidecar were already up, it timed
out:

    reading /mnt/cardano/preview/db's chain tip (throwaway clone, gates unset)...
    devnet fork: timed out reading the chain tip from /mnt/cardano/preview/db

Nothing was wrong with it but available memory (4.8 GB with one fork up). Passing
`--slot` skips the probe entirely, which is the cheap way to create a second fork
at a known point. `check_memory` guards starting a fork; it does not guard the
probe inside `create`.

## What this does not establish

- **Scripts through the SDK.** Phase 4 (`fork-mode-scripts.md`) proved native and
  Plutus scripts run under impersonation from the CLI; the provider here exposes
  `evaluateTransaction` and supplies collateral from the impersonated address, but
  no SDK-driven script spend has been run.
- **Datum-by-hash and asset lookups.** `resolveDatum`, `resolveScript` and
  `getUnspentOutputByNFT` all throw: ogmios serves no datum, script or asset
  index, and the alternative for the asset case is a whole-UTxO-set scan, which on
  preview is the sort of query that has already cost this host its memory. Inline
  datums and address-scoped asset queries work.
- **Confirmation is a UTxO poll**, not chain-sync: `awaitTransactionConfirmation`
  asks whether the transaction's output 0 is in the ledger. That reads false if
  something else spends output 0 first, which on a fork only the caller can do.
- **A published entry point.** One bridge now serves many forks, but nothing is
  published on it yet; a client must be on the host (or on the bridge) to reach a
  sidecar. The provider/explorer that would publish a single port is not built.
