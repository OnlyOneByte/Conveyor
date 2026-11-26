<script lang="ts">
  import { onMount, tick } from "svelte";
  import { announce } from "#lib/announce.js";
  import { shortcuts } from "#lib/app-shortcuts.js";
  import { POLL_MS } from "#lib/belt.js";
  import JobList from "#lib/components/JobList.svelte";
  import JobsState from "#lib/components/JobsState.svelte";
  import {
    canCancel,
    cancelRow,
    FILTERS,
    type Filter,
    groupRows,
    pillCount,
    type Row,
    retryRow,
  } from "#lib/jobs-list.js";
  import { createJobsView } from "#lib/jobs-view.js";
  import { singleKeyShortcuts } from "#lib/preferences.js";
  import { step } from "#lib/shortcuts.js";
  import { shortName } from "#lib/track.js";
  import Dialog from "#lib/ui/Dialog.svelte";
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/state";

  const view = createJobsView(() => page.url.searchParams.get("day"));
  let confirming = false;
  let chosen: string | undefined;
  let asking: Row | null = null;
  let root: HTMLElement;

  $: ({ filter, live, settled, counts, loaded, down, more, since } = $view);
  $: groups = groupRows(
    filter === "all" || filter === "live" ? live : [],
    filter === "live" ? [] : settled,
    new Date(),
  );
  $: rows = groups.flatMap((g) => g.rows);
  $: current = rows.find((row) => row.id === chosen) ?? rows[0];

  async function choose(next: Filter) {
    chosen = undefined;
    await view.choose(next);
  }

  async function move(by: number) {
    const at = Math.max(
      0,
      rows.findIndex((row) => row.id === current?.id),
    );
    chosen =
      rows[document.activeElement?.closest("[data-id]") ? step(at, by, rows.length) : at]?.id;
    await tick();
    root.querySelector<HTMLElement>(`[data-id="${CSS.escape(chosen ?? "")}"]`)?.focus();
  }

  async function retry() {
    announce(...(await retryRow(current)));
    await view.refresh().catch(view.markDown);
  }

  async function cancel(row: Row) {
    confirming = false;
    announce(...(await cancelRow(row)));
    await view.poll();
  }

  const ask = (row: Row | undefined) => {
    if (row && canCancel(row)) [asking, confirming] = [row, true];
    else void announce("Only a job on the belt can be canceled.", "polite");
  };
  afterNavigate(() => void choose(filter));

  onMount(() => {
    const timer = setInterval(view.poll, POLL_MS);
    const off = [
      shortcuts.register("j", () => move(1)),
      shortcuts.register("k", () => move(-1)),
      shortcuts.register("/", () =>
        root.querySelector<HTMLElement>(".pill[aria-pressed='true']")?.focus(),
      ),
      shortcuts.register("c", () => ask(current)),
      shortcuts.register("r", () => void retry()),
    ];
    return () => {
      clearInterval(timer);
      for (const unregister of off) unregister();
    };
  });
</script>

<svelte:head><title>Jobs · Conveyor</title></svelte:head>
<section class="jobs" bind:this={root}>
  <h1>Jobs</h1>
  {#if since !== undefined}<p class="today">Today only · <a href="/jobs">Show all jobs</a></p>{/if}
  <div class="pills" role="group" aria-label="Filter jobs">
    {#each FILTERS as f (f.id)}
      {@const n = down ? null : pillCount(f.id, live.length, counts)}
      <button type="button" class="pill" aria-pressed={filter === f.id} on:click={() => choose(f.id)}>{f.label}{#if n !== null}<span class="n">{n}</span>{/if}</button>
    {/each}
  </div>
  {#if !loaded}<JobsState kind="loading" {filter} />{:else if down}<JobsState kind="down" {filter} retry={view.load} />{/if}
  {#if loaded && !down && !rows.length}<JobsState kind="empty" {filter} today={since !== undefined} />
  {:else if rows.length}
    <JobList {groups} selected={current?.id} pick={(id) => (chosen = id)} />
    {#if more && filter !== "live"}<button class="btn older" type="button" on:click={view.older}>Show older jobs</button>{/if}
    {#if $singleKeyShortcuts}<p class="keys"><kbd>J</kbd> <kbd>K</kbd> move <kbd>↵</kbd> open <kbd>C</kbd> cancel <kbd>R</kbd> retry <kbd>/</kbd> filter</p>{/if}
  {/if}
</section>

<Dialog title={asking ? `Cancel ${shortName(asking.name)}?` : ""} bind:open={confirming}>
  <p>It stops where it is, and this can't be undone.</p>
  <svelte:fragment slot="actions">
    <button class="btn" type="button" on:click={() => (confirming = false)}>Keep it</button>
    <button class="btn danger" type="button" on:click={() => asking && cancel(asking)}>Cancel job</button>
  </svelte:fragment>
</Dialog>

<style>
  .jobs { display: grid; gap: var(--s3); }
  h1 { margin: 0; font: 800 var(--fs-title) / 1.1 var(--display); letter-spacing: -0.03em; }
  .pills { display: flex; flex-wrap: wrap; gap: 8px; }
  .pill { display: inline-flex; align-items: center; gap: 8px; padding: 0 16px; border: 1.5px solid var(--line-2); border-radius: var(--r-pill); background: transparent; color: var(--ink); font: 600 var(--fs-body) var(--display); white-space: nowrap; cursor: pointer; }
  .pill[aria-pressed="true"] { border-color: var(--ink); background: var(--ink); color: var(--bg); }
  .n { font: 500 var(--fs-mono) var(--mono); }
  .older { justify-self: start; min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body); text-decoration: none; }
  .keys, .today { margin: 0; color: var(--muted); font-size: var(--fs-chip); }
  @media (max-width: 759px) { .keys { display: none; } }
</style>
