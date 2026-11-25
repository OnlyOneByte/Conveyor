<script lang="ts">
  import { onMount, tick } from "svelte";
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import { announce } from "#lib/announce.js";
  import { fetchActiveJobs } from "#lib/api.js";
  import { shortcuts } from "#lib/app-shortcuts.js";
  import { POLL_MS } from "#lib/belt.js";
  import { midnight } from "#lib/belt-ends.js";
  import { type Catalog, loadCatalog } from "#lib/catalog.js";
  import JobList from "#lib/components/JobList.svelte";
  import JobsState from "#lib/components/JobsState.svelte";
  import { cancelRow, canCancel, type Counts, fetchCounts, fetchPage, type Filter, FILTERS, groupRows, latest, liveRow, mergeSettled, PAGE, pillCount, retryRow, type Row, settledRow } from "#lib/jobs-list.js";
  import { singleKeyShortcuts } from "#lib/preferences.js";
  import { step } from "#lib/shortcuts.js";
  import { shortName } from "#lib/track.js";
  import Dialog from "#lib/ui/Dialog.svelte";

  let filter: Filter = "all";
  let live: Row[] = [];
  let settled: Row[] = [];
  let counts: Counts | null = null, catalog: Catalog | null = null;
  let loaded = false, down = false, more = false, confirming = false;
  let chosen: string | undefined, asking: Row | null = null;
  let root: HTMLElement, since: number | undefined;
  const req = latest();

  $: groups = groupRows(filter === "all" || filter === "live" ? live : [], filter === "live" ? [] : settled, new Date());
  $: rows = groups.flatMap((g) => g.rows);
  $: current = rows.find((row) => row.id === chosen) ?? rows[0];

  async function poll() {
    const views = document.visibilityState === "visible" ? await fetchActiveJobs().catch(() => null) : null;
    if (!views) return;
    const was = new Set(live.map((row) => row.id));
    live = views.map((view) => liveRow(view, catalog, Date.now()));
    if ([...was].some((id) => !live.some((row) => row.id === id))) await refresh().catch(() => (down = true));
  }

  async function refresh(at = req.now()) {
    const got = await req.keep(at, Promise.all([fetchPage(filter, undefined, since), fetchCounts(since).catch(() => counts)]));
    if (!got) return;
    const [first, total] = got.value;
    const fresh = first.map((entry) => settledRow(entry, catalog, Date.now()));
    settled = loaded ? mergeSettled(settled, fresh) : fresh;
    if (!loaded) more = first.length === PAGE;
    counts = total;
  }

  async function load() {
    const at = req.start();
    since = page.url.searchParams.get("day") === "today" ? midnight(new Date()) : undefined;
    down = false;
    catalog = await loadCatalog().catch(() => null);
    const [views, history] = await Promise.allSettled([fetchActiveJobs(), refresh(at)]);
    if (at !== req.now()) return;
    down = history.status === "rejected";
    live = views.status === "fulfilled" ? views.value.map((view) => liveRow(view, catalog, Date.now())) : [];
    loaded = true;
  }

  async function choose(next: Filter) {
    [filter, loaded, settled, chosen] = [next, false, [], undefined];
    await load();
  }

  async function older() {
    const got = await req.keep(req.now(), fetchPage(filter, settled.at(-1), since).catch(() => null));
    const next = got?.value;
    if (!got) return;
    if (!next) return void announce("Couldn't load older jobs. Try again.", "assertive");
    settled = mergeSettled(settled, next.map((entry) => settledRow(entry, catalog, Date.now())));
    more = next.length === PAGE;
  }

  async function move(by: number) {
    const at = Math.max(0, rows.findIndex((row) => row.id === current?.id));
    chosen = rows[document.activeElement?.closest("[data-id]") ? step(at, by, rows.length) : at]?.id;
    await tick();
    root.querySelector<HTMLElement>(`[data-id="${CSS.escape(chosen ?? "")}"]`)?.focus();
  }

  async function retry() {
    announce(...(await retryRow(current)));
    await refresh().catch(() => (down = true));
  }

  async function cancel(row: Row) {
    confirming = false;
    announce(...(await cancelRow(row)));
    await poll();
  }

  const ask = (row: Row | undefined) => (row && canCancel(row) ? ([asking, confirming] = [row, true]) : announce("Only a job on the belt can be canceled.", "polite"));
  afterNavigate(() => void choose(filter));

  onMount(() => {
    const timer = setInterval(poll, POLL_MS);
    const off = [
      shortcuts.register("j", () => move(1)),
      shortcuts.register("k", () => move(-1)),
      shortcuts.register("/", () => root.querySelector<HTMLElement>(".pill[aria-pressed='true']")?.focus()),
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
  {#if !loaded}<JobsState kind="loading" {filter} />{:else if down}<JobsState kind="down" {filter} retry={load} />{/if}
  {#if loaded && !down && !rows.length}<JobsState kind="empty" {filter} today={since !== undefined} />
  {:else if rows.length}
    <JobList {groups} selected={current?.id} pick={(id) => (chosen = id)} />
    {#if more && filter !== "live"}<button class="btn older" type="button" on:click={older}>Show older jobs</button>{/if}
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
  .pill { display: inline-flex; align-items: center; gap: 8px; height: 42px; padding: 0 16px; border: 1.5px solid var(--line-2); border-radius: var(--r-pill); background: transparent; color: var(--ink); font: 600 var(--fs-body) var(--display); white-space: nowrap; cursor: pointer; }
  .pill[aria-pressed="true"] { border-color: var(--ink); background: var(--ink); color: var(--bg); }
  .n { font: 500 var(--fs-mono) var(--mono); }
  .older { justify-self: start; min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body); text-decoration: none; }
  .keys, .today { margin: 0; color: var(--muted); font-size: var(--fs-chip); }
  @media (max-width: 759px) { .pills { flex-wrap: nowrap; overflow-x: auto; } .keys { display: none; } }
</style>
