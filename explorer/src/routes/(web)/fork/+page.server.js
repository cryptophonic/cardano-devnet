import { listForks } from "$lib/server/fork"

export async function load() {
  return { forks: await listForks() }
}
