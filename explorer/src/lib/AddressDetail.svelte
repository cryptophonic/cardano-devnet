<script>
  import { formatTime, formatAge } from '$lib/time.js'
  let { addr } = $props()
  let changeAlias = $state({
    newValue: addr.alias,
    updating: false
  })
</script>
<table class="card border-separate border-spacing-4 shadow-lg">
  <tbody>
    <tr>
      <td>Address</td>
      <td>{ addr.address[0] }</td>
    </tr>
    <tr>
      <td>Address Alias</td>
      {#if addr.alias !== undefined}
        {#if changeAlias.updating === false}
          <td>{ addr.alias } <button class="btn ml-4" onclick={() => {
            changeAlias.newValue = addr.alias
            changeAlias.updating = true
          }}>Rename Alias</button></td>
        {:else}
          <td>
            <form method="POST" action="/alias">
              <input type="hidden" name="from" value={addr.alias}/>
              <input type="text" name="to" bind:value={changeAlias.newValue}/>
              <input type="hidden" name="address" value={addr.address[0]}/>
              <button type="submit" class="btn ml-4">Update</button>
              <button class="btn ml-4" onclick={() => changeAlias.updating = false}>Cancel</button>
            </form>
          </td>
        {/if}
      {:else}
        <td></td>
      {/if}
    </tr>
    <tr>
      <td>Tokens</td>
      <td>
        <table class="table-header-group border-separate border-spacing-4">
          <thead>
            <tr>
              <th>Policy ID : Token Name</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <a class="flex btn color-token shadow-xl" href="/token/ada/lovelace">
                  <img class="token" src="/cardano-ada-logo.svg" alt="ada"/>
                  <div>ada : lovelace</div>
                </a>
              <td class="text-center">&#x20B3; {addr.ada}</td>
            </tr>
            {#if addr.hasNativeTokens }
              {#each Object.entries(addr.ledger) as [unit, data] }
                <tr>
                  <td>
                    <a class="flex btn color-token shadow-xl" href="/token/{ data.policy[0] }/{ data.token }">
                      <img class="token" src="/{data.logo}" alt="{data.kpolicy}"/>
                      <div>{data.policy[1]} : {data.token}</div>
                    </a>
                  </td>
                  <td class="text-center">{ data.amount }</td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </td>
    </tr>
    {#if addr.unspent.length > 0}
      <tr>
        <td>Unspent UTxOs</td>
        <td>
          <div class="flex flex-wrap">
            {#each addr.unspent as utxo}
              <a class="btn color-unspent-utxo mr-2 shadow-xl" href="/utxo/{utxo.id[0]}/{utxo.ref}">{utxo.id[1]}#{utxo.ref}</a>
            {/each}
          </div>
        </td>
      </tr>
    {/if}
    {#if addr.history.length > 0}
      <tr>
        <td>Transaction History</td>
        <td>
          <table class="table-header-group border-separate border-spacing-4">
            <thead>
              <tr>
                <th>Block</th>
                <th>Transaction</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {#each addr.history as tx}
                <tr>
                  <td class="text-center">
                    <a class="btn color-block shadow-xl" href="/chain/{tx.block}">Block {tx.block}</a>
                  </td>
                  <td class="text-center">
                    <a class="btn color-transaction shadow-xl" href="/transaction/{tx.id[0]}">Tx {tx.id[1]}</a>
                  </td>
                  <td class="text-center whitespace-nowrap">
                    <div>{formatTime(tx.time)}</div>
                    {#if tx.time}<div class="opacity-60">({formatAge(tx.time)})</div>{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </td>
      </tr>
    {/if}
  </tbody>
</table>