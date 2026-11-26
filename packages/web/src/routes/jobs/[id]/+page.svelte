<script lang="ts">
  import ErrorDetails from "#lib/components/ErrorDetails.svelte";
  import Skeleton from "#lib/ui/Skeleton.svelte";
  import { afterNavigate, refreshAll, replaceState } from "$app/navigation";
  import type { JobPageData } from "./+page.js";
  import type { PageData } from "./$types";
  import JobPage from "./JobPage.svelte";

  export let data: PageData;

  let shown: JobPageData | null = null;
  let failed: string | null = null;
  afterNavigate(({ to }) => {
    if (to && location.pathname !== to.url.pathname) replaceState(to.url, {});
  });
  $: show(data.page);

  function show(pending: Promise<JobPageData>) {
    failed = null;
    void pending.then(
      (loaded) => {
        if (pending === data.page) shown = loaded;
      },
      (e: unknown) => {
        if (pending === data.page) failed = e instanceof Error ? e.message : String(e);
      },
    );
  }
</script>

<svelte:head>
  {#if failed !== null}<title>Can't load this job · Conveyor</title>
  {:else if !shown}<title>Job · Conveyor</title>{/if}
</svelte:head>

{#if shown}
  <JobPage data={shown} />
{:else if failed !== null}
  <section class="down" role="alert" aria-labelledby="down-title">
    <h1 id="down-title">Can't load this job</h1>
    <p>Conveyor didn't answer. Check that it's running, then try again.</p>
    <ErrorDetails detail={failed || null} />
    <button class="btn primary" type="button" on:click={() => refreshAll()}>Try again</button>
  </section>
{:else}
  <Skeleton kind="receipt" count={4} label="Loading the job" />
{/if}

<style>
  .down {
    display: flex; flex-direction: column; align-items: flex-start; gap: var(--s4);
    max-width: 520px; padding: 12vh 0 var(--s6);
  }
  h1 { margin: 0; font-size: var(--fs-title); }
  p { margin: 0; color: var(--muted); }
  .down :global(.why) { align-self: stretch; margin: 0; }
  .btn { min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body); }
</style>
