<script lang="ts">
  import StateCard from "./StateCard.svelte";

  export let none: boolean;
  export let add: (() => unknown) | null = null;
  export let button: HTMLButtonElement | null = null;
  let opening = false;

  async function take(run: () => unknown) {
    if (opening) return;
    opening = true;
    await run();
    opening = false;
  }
</script>

{#if none}
  <StateCard level={add ? "h2" : "h3"} title="Add your first printer">
    <p>Conveyor sends each job to a printer you add. It needs a name and the printer's address.</p>
    {#if add}
      <button
        class="btn primary" type="button" bind:this={button} aria-busy={opening}
        on:click={() => add && take(add)}
      >
        {opening ? "Opening…" : "Add a printer"}
      </button>
    {:else}<a class="btn primary" href="/printers?add">Add a printer</a>{/if}
  </StateCard>
{:else}
  <p class="note">No printer can print this yet. Add one on <a href="/printers">Printers</a>.</p>
{/if}

<style>
  .note { margin: 0; color: var(--muted); }
</style>
