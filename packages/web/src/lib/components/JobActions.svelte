<script lang="ts">
  import type { JobView } from "@conveyor/shared";
  import CancelJob from "./CancelJob.svelte";

  export let rerun: boolean;
  export let retry: boolean;
  export let held: boolean;
  export let live: JobView | null;
  export let again: () => void;
</script>

{#if rerun && held}
  <a class="btn primary" href="/printers">Check the printer</a>
{:else if rerun}
  <button class="btn primary" type="button" on:click={again}>
    {retry ? "Retry" : "Print again"}
  </button>
{:else if live}
  {#key live.jobId}<CancelJob id={live.jobId} printing={live.state === "printing"} />{/key}
{/if}

<style>
  .btn {
    min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body);
    text-decoration: none; border-color: var(--accent);
  }
</style>
