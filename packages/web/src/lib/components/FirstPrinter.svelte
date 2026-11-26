<script lang="ts">
  export let none: boolean;
  export let onPrinters = false;
</script>

{#if none}
  <div class="first">
    <svelte:element this={onPrinters ? "h2" : "h3"} class="t">Add your first printer</svelte:element>
    <p>Conveyor sends each job to a printer you add. It needs a name and the printer's address.</p>
    {#if !onPrinters}<a class="btn primary" href="/printers?add">Add a printer</a>{/if}
  </div>
{:else}
  <p class="note">No printer can print this yet. Add one on <a href="/printers">Printers</a>.</p>
{/if}

<style>
  .first {
    display: grid; gap: var(--s2); justify-items: start; padding: var(--s5);
    border: 1px dashed var(--line-2); border-radius: var(--r-card); color: var(--muted);
  }
  .t { margin: 0; color: var(--ink); font: 700 var(--fs-section) var(--display); }
  p { margin: 0; }
  .note { color: var(--muted); }
  .btn {
    min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body); text-decoration: none;
  }
</style>
