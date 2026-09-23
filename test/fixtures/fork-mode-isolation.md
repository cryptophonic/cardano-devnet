# Fork-mode node isolation — test fixtures (Phase 8)

Can the isolated fork-mode node reach, or be reached by, anything? Run on
`run-21` (fork gates @ slot 123372484, `BLOCK_EVERY=20`, clock faked to
`@2026-09-21 22:08:14`), image
`ghcr.io/cryptophonic/cardano-node-ogmios:v7.0.0_11.1.2-custom-cb30ce58-faketime`
(`sha256:d99bdaaa95e6…`). **The node was forging throughout** — every probe
below hit a live node, not a stopped one.

Host: `<HOST_LAN_IP>` on the LAN (wifi interface).

## 8a. The container has no network but loopback

    NetworkMode: none
    Networks:    none  ip=
    Ports:       map[]      PortBindings: map[]

`/proc/net/dev` inside the container lists exactly one interface:

    lo:  0 0 0 0 0 0 0 0   0 0 0 0 0 0 0 0

Zero bytes, zero packets — and still zero after the LAN probes in 8c, which is
the point: nothing from outside ever arrived.

## 8b. What it listens on, and where

    LISTEN 0 8       127.0.0.1:3001    users:(("cardano-node",pid=1,fd=24))
    LISTEN 0 1024    127.0.0.1:12798   users:(("cardano-node",pid=1,fd=17))

3001 is node-to-node, 12798 the metrics/EKG port. Both bind `127.0.0.1` — and
that loopback is the **container's own**, inside a namespace with no other
interface, so it is not the host's `127.0.0.1` either. No tcp6 listeners. No
connection ever leaves LISTEN state.

The only remote-flavoured line in the whole log is the node binding its own
socket:

    Net.Server.Remote.Started: TrServerStarted [127.0.0.1:3001]

No `ConnectionManager` / `InboundGovernor` / `PeerSelection` / `Handshake`
events at all. (The two greps that match `ConnectionManager` are the
`Reflection.TracerInfo` startup dump listing every tracer *name*, not events.)

## 8c. Not reachable from the LAN

Nothing on the **host** listens on either port — the host-side `ss -ltnp` has
no 3001/12798 row, and the iptables nat `DOCKER` chain is all `RETURN`, i.e.
no DNAT, because nothing is published.

From the host itself:

    <HOST_LAN_IP>:3001  → Connection refused
    <HOST_LAN_IP>:12798 → Connection refused

From a **different machine on the LAN** (user's Mac, `nc -vz <HOST_LAN_IP>
<port>`), with run-21 forging:

    3001  → Connection refused
    12798 → Connection refused

Refused, not filtered — a RST from the host because nothing is bound there,
which is the honest result rather than a drop that merely looks like absence.

**`ufw` is inactive on this host** (`Status: inactive`). Worth stating plainly:
the isolation is not firewall-enforced. It comes from the container's network
namespace and the absence of any published port, which is the stronger
guarantee — there is no rule to forget to re-enable, and enabling ufw later
cannot weaken it.

## Limits of this evidence

- The per-run container logs of runs 1–20 are **gone**: `scripts/isolated-node
  start` does `up -d --force-recreate` on the single `devnet-node-isolated`
  container name, so each run overwrites the previous run's log. "Zero peer
  connections across all fork-mode runs" is therefore verified for run-21
  directly, and for earlier runs only inasmuch as they used the identical
  compose service (`network_mode: none`, no `ports:`) — the configuration that
  makes a peer connection impossible is the same one, unchanged in
  `docker-compose.yml` since `538521a`.
- `run-12`/`run-13`'s `stock.log` are from deliberately **networked** stock
  nodes for the Phase 7 unfork test; peer traffic there is expected and not a
  counterexample.
- Not run: the strongest form, a stock cardano-node on another machine
  configured with `<HOST_LAN_IP>:3001` as its only peer, confirming it never
  handshakes. The refused TCP connect already establishes there is nothing to
  handshake with.
