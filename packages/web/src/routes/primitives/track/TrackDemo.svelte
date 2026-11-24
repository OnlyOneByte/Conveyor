<script lang="ts">
  import { page } from "$app/state";
  import Chip from "#lib/components/Chip.svelte";
  import Track from "#lib/components/Track.svelte";
  import { STUBS } from "./stubs";

  $: name = page.url.searchParams.get("jobs") ?? "8";
  $: jobs = (STUBS[name] ?? STUBS["8"] ?? (() => []))();
</script>

<h1>Track</h1>
{#if name === "states"}
  <ul class="board">
    {#each jobs as job (job.id)}<li><Chip jobs={[job]} /></li>{/each}
    <li><Chip jobs={jobs.slice(1, 4)} /></li>
  </ul>
{:else}
  <Track {jobs} idle="Nothing on the rail · Voron and Ender ready" />
{/if}

<style>
  .board { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--s4); padding: 0; list-style: none; }
  .board li { position: relative; height: 50px; }
</style>
