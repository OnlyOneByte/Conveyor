<script lang="ts">
  import type { CatalogPrinter, CatalogProfile } from "#lib/api.js";
  import FirstPrinter from "./FirstPrinter.svelte";
  import PrintAt from "./PrintAt.svelte";

  export let eligible: CatalogPrinter[];
  export let compatible: CatalogProfile[];
  export let all: number;
  export let printerId: string;
  export let profileId: string;
</script>

<section id="make-where" class="where" tabindex="-1">
  <h2>Where should it print?</h2>
  {#if eligible.length}
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
