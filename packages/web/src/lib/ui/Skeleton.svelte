<script lang="ts">
  export let kind: "rows" | "cards" | "make" | "receipt" = "rows";
  export let count = 3;
  export let label: string;
  export let spoken = true;
</script>

{#if spoken}<p class="sr">{label}…</p>{/if}
<div class="sk {kind}" aria-hidden="true" data-loading={label}>
  {#if kind === "make" || kind === "receipt"}
    <i class="mat"></i>
    <div class="side">
      <i class="bar head"></i>
      {#each Array(count) as _}<i class="bar field"></i>{/each}
      {#if kind === "make"}<i class="bar dock"></i>{/if}
    </div>
  {:else}
    {#each Array(count) as _}
      <div class="item"><i class="dot"></i><i class="bar long"></i><i class="bar short"></i></div>
    {/each}
  {/if}
</div>

<style>
  .sk { display: grid; gap: var(--s3); }
  i {
    display: block; border-radius: var(--r-inner); background: var(--sunk);
    animation: pulse var(--t-breathe) ease-in-out infinite alternate;
  }
  .item {
    display: grid; grid-template-columns: 22px minmax(0, 1fr) 120px; gap: var(--s3);
    align-items: center; min-height: 56px; padding: 0 var(--s4);
    border: 1px solid var(--line); border-radius: var(--r-card);
  }
  .cards { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--s4); }
  .cards .item {
    grid-template-columns: minmax(0, 1fr); align-content: start; min-height: 200px;
    padding: var(--s4) var(--s5);
  }
  .cards .dot { display: none; }
  .dot { width: 22px; height: 22px; border-radius: 50%; }
  .bar { height: 12px; }
  .long { width: 60%; }
  .short { width: 100%; }
  .make, .receipt {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.45fr); gap: var(--s6); align-items: start;
  }
  .mat { height: 540px; border-radius: var(--r-panel); }
  .side { display: grid; gap: var(--s4); }
  .head { width: 70%; height: 36px; }
  .field { height: 44px; border-radius: var(--r-control); }
  .dock { height: 80px; border-radius: var(--r-panel); }
  @keyframes pulse { from { opacity: 1; } to { opacity: 0.45; } }
  @media (max-width: 759px) {
    .make, .receipt { grid-template-columns: minmax(0, 1fr); gap: var(--s4); }
    .mat { height: 180px; }
    .item { grid-template-columns: 22px minmax(0, 1fr) 72px; padding: 0 var(--s3); }
  }
</style>
