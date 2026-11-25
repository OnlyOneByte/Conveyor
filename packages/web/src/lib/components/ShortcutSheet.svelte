<script lang="ts">
  import { singleKeyShortcuts } from "#lib/preferences.js";
  import { SHEET } from "#lib/shortcuts.js";
  import Button from "#lib/ui/Button.svelte";
  import Dialog from "#lib/ui/Dialog.svelte";
  import Switch from "#lib/ui/Switch.svelte";
  export let open = false;
</script>

<Dialog title="Keyboard shortcuts" bind:open>
  <table>
    <tbody>
      {#each SHEET as [keys, does]}
        <tr><th scope="row"><kbd>{keys}</kbd></th><td>{does}</td></tr>
      {/each}
    </tbody>
  </table>
  <Switch label="Single-key shortcuts" bind:checked={$singleKeyShortcuts} />
  <p class="muted">Off leaves only ⌘K / Ctrl K.</p>
  <svelte:fragment slot="actions"><Button on:click={() => (open = false)}>Close</Button></svelte:fragment>
</Dialog>

<style>
  table { width: 100%; margin-bottom: var(--s4); border-collapse: collapse; }
  th { padding: var(--s1) var(--s3) var(--s1) 0; text-align: left; font-weight: 400; white-space: nowrap; }
  td { padding: var(--s1) 0; }
  p { margin: var(--s2) 0 0; font-size: var(--fs-chip); }
</style>
