<script>
  export let token
</script>
<table class="card border-separate border-spacing-4 shadow-lg">
  <tbody>
    <tr>
      <td></td>
      <td>
        <img class="token" src="/{token.logo}" alt="{token.name}"/>
      </td>
    </tr>
    <tr>
      <td>Policy ID</td>
      <td>{ token.policy }</td>
    </tr>
    <tr>
      <td>Token Name</td>
      <td>{ token.token }</td>
    </tr>
    <tr>
      <td>Supply</td>
      <td>{ token.supply } <span class="opacity-60">across { token.holderCount } address{#if token.holderCount !== 1}es{/if}</span></td>
    </tr>
    <tr>
      <td>Addresses</td>
      <td>
        <table class="table-header-group border-separate border-spacing-4">
          <thead>
            <tr>
              <td>Address</td>
              <td>Alias</td>
              <td>Amount</td>
            </tr>
          </thead>
          <tbody>
            {#each token.ledger as addr}
              <!-- largest first, so the ten shown are the ten that matter -->

              <tr>
                <td><a class="btn color-address shadow-xl" href="/address/{addr.address[0]}">{ addr.address[1] }</a></td>
                <td>{#if addr.alias !== undefined}<a href="/address/{addr.address[0]}">{addr.alias}</a>{:else}--{/if}</td>
                <td>{ addr.amount }</td>
              </tr>
            {/each}
            {#if token.omitted > 0}
              <tr>
                <td colspan="3" class="opacity-60">
                  and { token.omitted } more holder{#if token.omitted !== 1}s{/if} not shown
                </td>
              </tr>
            {/if}
          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>