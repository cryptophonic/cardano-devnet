<script>
  import "../../app.css"
  import Legend from "$lib/Legend.svelte"
  import SearchBar from "$lib/SearchBar.svelte"
  export let data

  import { browser } from "$app/environment"
  export let latest = data.height
  if (browser) {
    // API REST call to wait for next block
    async function getNextBlock() {
      const resp = await fetch('/api/waitblock')
      const data  = await resp.json()
      latest = data.height
      getNextBlock()
    }
    getNextBlock()
  }
</script>
<div class="flex flex-col">
  <div class="flex justify-center pb-4">
    <h1 class="text-3xl font-bold">Cardano Devnet Explorer</h1>
  </div>
  <div class="flex justify-between">
    <a class="btn color-block shadow-xl" href="/chain/0">Genesis Block</a>
    <a class="btn color-block shadow-xl" href="/chain/{latest}">Latest Block {latest}</a>
  </div>
  <div class="mt-4 mb-4">
    <SearchBar/>
  </div>
  <div class="w-full self-center flex flex-row">
    <div class="flex flex-col w-64 bg-gray-200 card shadow-xl p-4">
      <div class="self-center font-bold pb-4">Token Totals</div>
      {#each Object.entries(data.tokens) as [name, token]}
        <a class="card color-token shadow p-4 mb-2" href="/token/{token.policy}/{token.token}">
          <img class="self-center token" src="/{token.logo}" alt="{name}"/>
          <div class="self-center">{token.amount}</div>
        </a>
      {/each}
    </div>
    <div class="flex flex-col ml-4 mr-4 grow">
      <slot/>
    </div>
    <div class="bg-gray-200 card shadow-xl p-4">
      <Legend/>
    </div>
  </div>
</div>
