<script lang="ts">
  import { onMount } from "svelte";
  import { announce } from "#lib/announce.js";
  import { EMPTY, type Filter } from "#lib/jobs-list.js";

  export let kind: "loading" | "down" | "empty";
  export let filter: Filter;
  export let retry: () => void = () => {};
  export let today = false;
  onMount(() => {
    if (kind === "loading") void announce("Loading jobs…");
    else if (kind === "down") void announce("Can't reach Conveyor. The job history didn't load", "assertive");
  });
</script>

{#if kind === "loading"}
  <p class="state">Loading jobs…</p>
{:else if kind === "down"}
  <div class="state"><p class="big">Can't reach Conveyor</p><p>The job history didn't load. Check that the server is running, then try again.</p><button class="btn primary" type="button" on:click={retry}>Try again</button></div>
{:else}
  <div class="state"><p class="big">{today ? "Nothing finished today" : EMPTY[filter]}</p>{#if filter === "all" && !today}<p>Jobs show up here as soon as you print one.</p><a class="btn primary" href="/">Make something</a>{/if}</div>
{/if}

<style>
  .state { display: grid; gap: var(--s2); justify-items: start; margin: 0; padding: var(--s5); border: 1px dashed var(--line-2); border-radius: var(--r-card); color: var(--muted); }
  .state p { margin: 0; color: var(--muted); }
  .state .big { color: var(--ink); font: 700 18px var(--display); }
  .btn { min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body); text-decoration: none; }
</style>
