<script>
  import { formatTime, formatAge } from '$lib/time.js'
  export let block
</script>
<div class="flex justify-center mb-8">
  {#if block.height > 0}
  <a class="btn mr-2 color-block shadow-xl" href="/chain/{block.height-1}">&lt;&lt;&lt; Prev Block {block.height-1}</a>
  {/if}
  <a class="btn mr-2 shadow-xl" href="/pages/blocks/{block.page}">Page</a>
  {#if block.height < block.latest}
  <a class="btn color-block shadow-xl" href="/chain/{block.height+1}">Next Block {block.height+1} &gt;&gt;&gt;</a>
  {/if}
</div>
<div class="card-title justify-center mb-5">Block {block.height}</div>
<table class="card border-separate border-spacing-4 shadow-lg">
  <tbody>
    <tr>
      <td>ID</td>
      <td>{block.hash[0]}</td>
    </tr>
    <tr>
      <td>Height</td>
      <td>{block.height}</td>
    </tr>
    <tr>
      <td>Time Slot</td>
      <td>{block.slot}</td>
    </tr>
    <tr>
      <td>Time</td>
      <td>{formatTime(block.time)} {#if block.time}<span class="opacity-60">({formatAge(block.time)})</span>{/if}</td>
    </tr>
    <tr>
      <td>Transactions</td>
      <td>
        {#if block.txs.length > 0}
          <div class="flex flex-row flex-wrap">
            {#each block.txs as tx}
              <a class="flex flex-col btn color-transaction mr-2 shadow-xl" href="/transaction/{tx.hash[0]}">
                <div>Tx {tx.hash[1]}</div>
                <div>{tx.inputCount} input{#if tx.inputCount != 1}s{/if} -&gt; {tx.outputCount} output{#if tx.outputCount != 1}s{/if}</div>
              </a>    
            {/each}
          </div>
        {:else}
          None
        {/if}
      </td>
    </tr>
  </tbody>
</table>