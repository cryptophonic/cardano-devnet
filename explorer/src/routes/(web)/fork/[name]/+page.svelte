<script>
  export let data
  $: m = data.manifest
</script>
<div class="flex grow">
  <div class="grow card color-address shadow-xl p-8">
    <div class="card-title justify-center mb-4">
      Fork {data.name} -- {data.running ? '● running' : '○ stopped'}
    </div>
    <table class="card border-separate border-spacing-4 shadow-lg">
      <tbody>
        <tr>
          <td>Network</td>
          <td>{m.network} (magic {m.networkMagic})</td>
        </tr>
        <tr>
          <td>Fork point</td>
          <td>slot {m.fork.slot} &middot; epoch {m.fork.epoch} &middot; {m.fork.hash ?? '(hash not recorded)'}</td>
        </tr>
        <tr>
          <td>God key</td>
          <td>{m.godKeyHash}</td>
        </tr>
        <tr>
          <td>Producer</td>
          <td>
            pool {m.producer.poolId}<br/>
            {m.producer.address}<br/>
            KES period {m.producer.opcertKesPeriod} ({m.producer.kesPeriodsValid} periods valid from issue)
          </td>
        </tr>
        <tr>
          <td>Clock</td>
          <td>rate x{m.clock.rate} &middot; anchored {m.clock.anchor} &middot; {m.clock.mode} mode{m.clock.fakeMonotonic ? ' · CLOCK_MONOTONIC faked' : ''}</td>
        </tr>
        <tr>
          <td>Cadence</td>
          <td>{m.blockEvery ? `blockEvery ${m.blockEvery}` : '(not forging -- follower or no cadence set)'}</td>
        </tr>
        <tr>
          <td>Image</td>
          <td>{m.image}{#if m.imageDigest}<br/>{m.imageDigest}{/if}</td>
        </tr>
        {#if m.seeds}
          <tr>
            <td>Seeds</td>
            <td>{m.seeds.count} &ge; {m.seeds.minAda} ADA, extracted {m.seeds.extractedAt}</td>
          </tr>
        {/if}
        {#if data.running}
          {#if data.tip}
            <tr>
              <td>Live tip</td>
              <td>slot {data.tip.slot} &middot; block {data.tip.block} &middot; epoch {data.tip.epoch} &middot; {data.tip.era} &middot; {data.tip.syncProgress}%</td>
            </tr>
            {#if data.blocksSinceFork !== null}
              <tr>
                <td>Since fork</td>
                <td>~{data.blocksSinceFork} block{data.blocksSinceFork === 1 ? '' : 's'} (approximate: (tip slot &minus; fork slot) / blockEvery)</td>
              </tr>
            {/if}
          {:else}
            <tr>
              <td>Live tip</td>
              <td class="opacity-50">node is still starting up</td>
            </tr>
          {/if}
          {#if data.clock}
            <tr>
              <td>Faked now</td>
              <td>slot {data.clock.slot} &middot; {data.clock.time} &middot; KES period {data.clock.kesPeriod} ({data.clock.source})</td>
            </tr>
            {#if data.kesRemaining !== null}
              <tr>
                <td>KES periods remaining</td>
                <td class={data.kesRemaining <= 0 ? 'font-bold' : ''}>{data.kesRemaining}{#if data.kesRemaining <= 0} -- EXPIRED, needs a new opcert{/if}</td>
              </tr>
            {/if}
          {:else}
            <tr>
              <td>Faked now</td>
              <td class="opacity-50">{data.clockError}</td>
            </tr>
          {/if}
        {/if}
      </tbody>
    </table>
  </div>
</div>
