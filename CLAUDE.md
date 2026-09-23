# cardano-devnet

## Claude View detail section

After each response, overwrite `.claude/view/detail.md` with the **current
cardano-node preview-chain status** — do not append, it is a live snapshot:

- The active fork run (and any other running node): **running / stopped**,
  current **tip** (slot · block · epoch · era · sync%), and fork slot + cadence
  if forging. Query a running node's tip via its socket
  (`CARDANO_NODE_SOCKET_PATH=<run>/ipc/node.socket cardano-cli latest query tip --testnet-magic 2`).
- The **golden preview DB** (`/mnt/cardano/preview/db`): node running/stopped and
  its last-known tip.
- A short table of run directories and their state.

If a response does not change node state, refresh the tip/timestamp anyway (or
say in the terminal that it is unchanged).
