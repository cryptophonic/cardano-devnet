# cardano-devnet — notes for contributors

Guidance for anyone (human or agent) working in this repo. Machine-specific and
personal workflow settings do **not** belong here — keep those in a local,
untracked `CLAUDE.local.md`.

## Environment

The repo is driven by [direnv](https://direnv.net/): `.envrc` exports
`DEVNET_ROOT`, `CARDANO_NODE_SOCKET_PATH`, `CARDANO_CLI_GURU` and the
`cardano-cli-guru` asset paths, and puts `scripts/`, `node_modules/.bin` and
`cardano-cli-guru/scripts` on `PATH`. Run `direnv allow` after cloning, or
nothing else in this file will work. See the README for full install steps
(docker, ghcr.io login, submodules, `npm install`).

## Use the wrappers in `scripts/`, not bare binaries

`scripts/cardano-node` and `scripts/cardano-cli` are front ends: if a real
binary exists elsewhere on `PATH` they exec it, otherwise they run the
published devnet image in docker, translating `DEVNET_ROOT`/`CARDANO_CLI_GURU`
paths into container paths. Invoking a host `cardano-cli` directly will pass
host paths the container can't see, and may be a different node version than
the devnet is running. Always go through the wrapper.

The node/cli/ogmios image is `ghcr.io/cryptophonic/cardano-node-ogmios`;
override it with `DEVNET_IMAGE`. This repo only consumes the published image —
building and pushing it (Dockerfile, build-faketime, publish) lives in the
separate `fork-mode` repo, which is also the parent of the patched
cardano-node source.

## Runs and snapshots (the generic layer)

Any chain DB can be cloned into an isolated, numbered run directory and run
by its own node. The scripts carry their own usage notes in their headers —
read those first:

- `scripts/new-run` — build a numbered run directory from any run source (CoW
  clone of its DB, isolated config/topology, forging credentials). Sources are
  the golden preview DB (keys + fresh opcert generated) or a devnet snapshot
  made by `scripts/snapshot` (self-credentialed; needs no cardano-cli at all).
  `scripts/new-isolated-run` is a back-compat shim for it.
- `scripts/snapshot` — freeze the local devnet (clean stop/copy/restart) into
  a run source under `snapshots/`, same db/+config/ shape as the golden dir.
- `scripts/isolated-node` — start/stop/log a run, or run `cardano-cli` against
  its socket. Fully isolated: the Unix socket is the only way in or out.
- `scripts/set-faketime` — shift a run's clock so a stale DB stays inside the
  ledger's forecast horizon.

Convention that matters: **never run a node against the golden DB.** It is
the read-only master copy. Always work in a numbered run directory produced
by `new-run` (reflink/CoW clone, so copies are cheap on XFS/btrfs). Locations
are configurable: `GOLDEN_DB`, `RUNS_DIR`, `CARDANO_CLI_BIN`.

Fork mode — running a patched node against a snapshot of a real preview
chain, with the fork SDK, impersonation, clock warping and the fork panel —
lives in the separate [adafork](https://github.com/cryptophonic/adafork)
repo, which builds on this layer (it requires `DEVNET_ROOT` pointing at this
checkout). The fork-mode ledger-behaviour fixtures moved there too
(`server/test/fixtures/`).

## Repo layout

- `scripts/` — all entry points (`start-cardano-devnet`, `fund`, `monitor`,
  `indexer`, `explorer`, run/snapshot tooling).
- `src/` — node-side JS: monitor, indexer, fund, Blaze/Lucid provider.
- `explorer/` — SvelteKit web explorer (its own `npm install`).
- `config/` — genesis, credentials and node config for the local devnet.
- `docker-compose.yml` — service definitions (the image itself is built and
  published from the separate `fork-mode` repo).
- `cardano-cli-guru/` — submodule providing the address-alias tooling.

## Housekeeping

- `runtime/` is live state, not source; it's gitignored along with `.env` and
  `cardano-devnet.log`.
- Keep this file free of anything tied to one machine, one operator, or one
  agent's workflow.
