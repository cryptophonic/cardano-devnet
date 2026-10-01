import { error } from "@sveltejs/kit"
import { loadFork } from "$lib/server/fork"

export async function load({ params }) {
  const fork = await loadFork(params.name)
  if (!fork) {
    throw error(404, `no manifest for fork '${params.name}' -- devnet fork adopt ${params.name}`)
  }
  return fork
}
