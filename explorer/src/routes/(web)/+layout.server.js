import { loadLatest } from "$lib/server"

export function load({ url }) {
  // Touching `url` is what makes this re-run on client-side navigation.
  //
  // A load with no parameters and no declared dependencies runs once per full
  // page load and is then reused, so the header's height and token totals
  // froze at whatever was true when the tab was opened. Clicking through
  // blocks could leave them minutes behind the chain, or show no tokens at all
  // because the page happened to load before the first block was indexed.
  // Every navigation is a fresh read now.
  void url.pathname
  return loadLatest()
}