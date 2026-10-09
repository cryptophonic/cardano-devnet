// Serves the images named in runtime/tokens.json. They live outside static/
// because they belong to whatever chain was created on this devnet, not to
// the explorer.

import fs from 'fs'
import { error } from '@sveltejs/kit'
import { logoFile } from '$lib/server/tokens.js'

const TYPES = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp"
}

export function GET({ params }) {
  // The params are only ever a lookup key -- the path itself comes from the
  // override file, so a hostile URL cannot reach outside it.
  const file = logoFile(params.policy, params.token)
  if (file === undefined) error(404, "no logo for " + params.policy + ":" + params.token)

  const type = TYPES[file.slice(file.lastIndexOf(".")).toLowerCase()]
  if (type === undefined) error(415, "unsupported logo type: " + file)

  let body
  try {
    body = fs.readFileSync(file)
  } catch (err) {
    error(404, "logo file is unreadable: " + file + " (" + err.message + ")")
  }
  return new Response(body, {
    headers: { "content-type": type, "cache-control": "no-cache" }
  })
}
