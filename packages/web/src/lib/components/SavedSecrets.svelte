<script lang="ts">
  export let saved = false;
  export let cleared = false;
  export let busy = false;
  export let clear: () => void;
</script>

{#if saved}
  <div class="saved">
    <span>A key is saved for this printer. It stays until you clear it.</span>
    <button class="btn" type="button" disabled={busy} on:click={clear}>Clear saved secrets</button>
  </div>
{:else if cleared}
  <p class="saved" role="status">Saved secrets cleared.</p>
{/if}

<style>
  p { margin: 0; }
  .saved { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s3); padding: var(--s3); border-radius: var(--r-control); background: var(--sunk); color: var(--muted); }
  .saved span { flex: 1; min-width: 12rem; }
</style>
