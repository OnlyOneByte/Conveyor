<script lang="ts">
  import Dialog from "#lib/ui/Dialog.svelte";

  export let open = false;
  export let title: string;
  export let keep: string;
  export let go: string;
  export let busy = false;
  export let run: () => void;
</script>

<Dialog {title} bind:open>
  <slot />
  <svelte:fragment slot="actions">
    <button class="btn ghost" type="button" on:click={() => (open = false)}>{keep}</button>
    <button class="btn danger" type="button" disabled={busy} on:click={run}>{go}</button>
  </svelte:fragment>
</Dialog>
