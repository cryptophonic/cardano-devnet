// Slots are dated server-side (only the server talks to ogmios, so only it
// knows when slot zero was). These render the epoch-ms result.
//
// UTC rather than local: the server and the browser are often different
// machines on a devnet, and the node's own logs are in UTC, so this is the
// column you can line up against them.

export function formatTime(ms) {
  if (ms === null || ms === undefined) return '—'
  const d = new Date(ms)
  const p = n => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
         `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`
}

/** "12s ago", for a time the viewer is watching arrive. */
export function formatAge(ms, now = Date.now()) {
  if (ms === null || ms === undefined) return ''
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`
  return `${Math.floor(s / 86400)}d ago`
}
