<script lang="ts">
  import Skeleton from "#lib/ui/Skeleton.svelte";
  import { afterNavigate, replaceState } from "$app/navigation";
  import type { JobPageData } from "./+page.js";
  import type { PageData } from "./$types";
  import JobPage from "./JobPage.svelte";

  export let data: PageData;

  let shown: JobPageData | null = null;
  afterNavigate(({ to }) => {
    if (to && location.pathname !== to.url.pathname) replaceState(to.url, {});
  });
  $: show(data.page);

  function show(pending: Promise<JobPageData>) {
    void pending.then((loaded) => {
      if (pending === data.page) shown = loaded;
    });
  }
</script>

{#if shown}
  <JobPage data={shown} />
{:else}
  <Skeleton kind="receipt" count={4} label="Loading the job" />
{/if}
