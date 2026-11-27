<script lang="ts">
  import { onMount } from "svelte";
  import { announce } from "#lib/announce.js";
  import { EMPTY, type Filter } from "#lib/jobs-list.js";
  import Skeleton from "#lib/ui/Skeleton.svelte";
  import StateCard from "./StateCard.svelte";

  export let kind: "loading" | "down" | "empty";
  export let filter: Filter;
  export let retry: () => void = () => {};
  export let today = false;
  onMount(() => {
    if (kind === "loading") void announce("Loading jobs…");
    else if (kind === "down")
      void announce("Can't reach Conveyor. The job history didn't load", "assertive");
  });
</script>

{#if kind === "loading"}
  <Skeleton count={3} label="Loading jobs" spoken={false} />
{:else if kind === "down"}
  <StateCard tone="err" title="Can't reach Conveyor">
    <p>The job history didn't load. Check that Conveyor is running, then try again.</p>
    <button class="btn primary" type="button" on:click={retry}>Try again</button>
  </StateCard>
{:else}
  <StateCard title={today ? "Nothing finished today" : EMPTY[filter]}>
    {#if filter === "all" && !today}
      <p>Jobs show up here as soon as you print one.</p>
      <a class="btn primary" href="/">Make something</a>
    {/if}
  </StateCard>
{/if}
