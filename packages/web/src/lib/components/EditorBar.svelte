<script lang="ts">
  import Confirm from "./Confirm.svelte";
  export let name: string;
  export let status: string;
  export let busy: boolean;
  export let edited: boolean;
  export let canSave: boolean;
  export let tidy: (() => void) | null | undefined = undefined;
  export let save: () => void;
  export let reset: () => Promise<void>;

  let resetting = false;

  async function confirmReset() {
    await reset();
    resetting = false;
  }
</script>

<div class="bar">
  {#if edited}
    <button class="btn danger" type="button" disabled={busy} on:click={() => (resetting = true)}>
      Reset to original
    </button>
  {/if}
  {#if tidy !== undefined}
    <button class="btn" type="button" disabled={!tidy} on:click={() => tidy?.()}>
      Tidy layout
    </button>
  {/if}
  <span class="sp"></span>
  <span class="status" role="status">{status}</span>
  <a class="btn ghost" href="/settings">Cancel</a>
  <button class="btn primary" type="button" disabled={!canSave} on:click={save}>Save</button>
</div>

<Confirm
  bind:open={resetting}
  title="Reset {name}?"
  keep="Keep my edits"
  go="Reset"
  {busy}
  run={confirmReset}
>
  <p>Every file goes back to how it was when the profile was added. Your edits are lost.</p>
</Confirm>

<style>
  p { margin: 0; }
  .bar {
    position: sticky; bottom: var(--tabbar, 0px); z-index: 3; display: flex; align-items: center;
    flex-wrap: wrap; gap: var(--s2); margin-top: var(--s3); padding: var(--s3) 0;
    background: var(--bg);
  }
  .bar .btn { min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body); }
  .sp { flex: 1; }
  .status { color: var(--muted); font-size: var(--fs-chip); }
  @media (max-width: 759px) { .bar .primary { flex: 1; } }
</style>
