<script lang="ts">
  import type { CatalogPrinter, CatalogProfile } from "#lib/api.js";
  import { invalidateAll } from "$app/navigation";
  import FirstPrinter from "./FirstPrinter.svelte";
  import Notice from "./Notice.svelte";
  import PrintAt from "./PrintAt.svelte";

  export let down = false;
  export let eligible: CatalogPrinter[];
  export let compatible: CatalogProfile[];
  export let all: number;
  export let printerId: string;
  export let profileId: string;
</script>

<section id="make-where" class="where" tabindex="-1">
  <h2>Where should it print?</h2>
  {#if down}
    <Notice tone="err" title="Can't reach Conveyor" role="alert">
      <span slot="message">
        The printer list didn't load. Check that Conveyor is running, then try again.
      </span>
      <button slot="action" class="btn" type="button" on:click={() => invalidateAll()}>
        Try again
      </button>
    </Notice>
  {:else if eligible.length}
    <PrintAt
      printers={eligible} profiles={compatible} hidden={all - eligible.length}
      bind:printerId bind:profileId
    />
  {:else}
    <FirstPrinter none={!all} />
  {/if}
</section>

<style>
  .where { outline: none; scroll-margin-top: var(--belt-h, 0px); }
  h2 { margin: 0 0 var(--s2-5); font-size: var(--fs-section); }
</style>
