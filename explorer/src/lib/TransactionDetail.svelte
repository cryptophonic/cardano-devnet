<script>
    import { formatTime, formatAge } from '$lib/time.js'
    export let tx
</script>
<table class="card border-separate border-spacing-4 shadow-lg">
  <tbody>
    <tr>
      <td>ID</td>
      <td>{tx.id}</td>
    </tr>
    <tr>
      <td>Finalized</td>
      <td><a class="btn color-block shadow-xl p-4" href="/block/{tx.block[0]}">Block {tx.blockHeight}</a></td>
    </tr>
    <tr>
      <td>Time</td>
      <td>{formatTime(tx.time)} {#if tx.time}<span class="opacity-60">({formatAge(tx.time)})</span>{/if}</td>
    </tr>
    <tr>
      <td>UTxOs</td>
      <td>
        <table class="table-header-group border-separate border-spacing-4">
          <thead>
            <tr>
              <th>Inputs</th>
              <th>Outputs</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div class="flex flex-col">
                  {#if tx.inputs.length > 0}
                    {#each tx.inputs as input}
                      <a class="self-center card flex flex-col flex-nowrap p-2 color-spent-utxo shadow-xl mb-2" href="/utxo/{input.hash[0]}/{input.ref}">
                        <div class="self-center">{input.hash[1]}#{input.ref}</div>
                        <div class="self-center">{input.addr[1]}</div>
                        {#if input.alias !== undefined}
                          <div class="self-center">{input.alias}</div>
                        {/if}
                        <div class="self-center">&#x20B3; {input.value["ada"]} {#if input.tokenCount > 0}+ token(s){/if}</div>
                      </a>
                    {/each}
                  {:else}
                    Genesis transaction 
                  {/if}
                </div>
              </td>
              <td>
                <div class="flex flex-col">
                  {#each tx.outputs as output}
                    {#if output.spentBy === "unspent"}
                      <a class="self-center card flex flex-col flex-nowrap p-2 color-unspent-utxo shadow-xl mb-2" href="/utxo/{tx.id}/{output.ref}">
                        <div class="self-center">{tx.hash[1]}#{output.ref}</div>
                        <div class="self-center">Addr {output.addr[1]}</div>
                        {#if output.alias !== undefined}
                          <div class="self-center">{output.alias}</div>
                        {/if}
                        <div class="self-center">&#x20B3; {output.value["ada"]} {#if output.tokenCount > 0}+ token(s){/if}</div>
                      </a>
                    {:else}
                      <a class="self-center card flex flex-col p-2 color-spent-utxo shadow-xl mb-2" href="/utxo/{tx.id}/{output.ref}">
                        <div class="self-center">{tx.hash[1]}#{output.ref}</div>
                        <div class="self-center">Addr {output.addr[1]}</div>
                        {#if output.alias !== undefined}
                          <div class="self-center">{output.alias}</div>
                        {/if}
                        <div class="self-center">&#x20B3; {output.value["ada"]} {#if output.tokenCount > 0}+ token(s){/if}</div>
                      </a>
                    {/if}
                  {/each}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
    <tr>
      <td>Fee</td>
      <td>&#x20B3; {tx.fee}</td>
    </tr>
  </tbody>
</table>