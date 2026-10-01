<script>
  export let data
</script>
<div class="flex flex-wrap grow">
  {#each data.forks as fork}
    {#if fork.manifest}
      <a href="/fork/{fork.name}">
        <div class="rounded-lg color-block shadow-xl flex flex-col p-4 mr-2 mb-2">
          <div class="font-bold">{fork.name}</div>
          <div>{fork.running ? '● running' : '○ stopped'}</div>
          <div>fork slot {fork.manifest.fork.slot}</div>
          <div>rate x{fork.manifest.clock.rate}</div>
        </div>
      </a>
    {:else}
      <div class="rounded-lg shadow-xl flex flex-col p-4 mr-2 mb-2 opacity-50">
        <div class="font-bold">{fork.name}</div>
        <div>no manifest (devnet fork adopt {fork.name})</div>
      </div>
    {/if}
  {/each}
  {#if data.forks.length === 0}
    <div>No fork run directories found.</div>
  {/if}
</div>
