<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fetchJobHistory, type JobHistoryEntry } from "$lib/api";
  import RecentJobs from "$lib/components/RecentJobs.svelte";

  // The DURABLE, server-side job history (persisted in SQLite by the worker), as
  // opposed to the per-browser strip on the home page — that one is localStorage and
  // only knows about jobs submitted from this browser.
  let history: JobHistoryEntry[] = [];
  let error: string | null = null;
  let loaded = false;

  // Auto-refresh: the durable table only gains rows as jobs SETTLE, so a slow poll is
  // plenty — a finishing job appears within one interval without a manual reload.
  const REFRESH_MS = 10000;
  let timer: ReturnType<typeof setInterval> | undefined;

  // Filters (client-side over the fetched window). state = a JobState or "all";
  // query matches job id / generator / printer / profile, case-insensitive.
  const STATE_FILTERS = ["all", "done", "failed", "canceled"] as const;
  type StateFilter = (typeof STATE_FILTERS)[number];
  let stateFilter: StateFilter = "all";
  let query = "";

  async function reload() {
    try {
      history = await fetchJobHistory();
      error = null;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loaded = true;
    }
  }
  onMount(() => {
    void reload();
    timer = setInterval(reload, REFRESH_MS);
  });
  onDestroy(() => clearInterval(timer));

  function fmtDate(ms: number): string {
    return new Date(ms).toLocaleString();
  }

  // Count per state across the whole fetched window, so the chips show live totals
  // regardless of which chip is active.
  $: counts = history.reduce<Record<string, number>>((acc, j) => {
    acc[j.state] = (acc[j.state] ?? 0) + 1;
    return acc;
  }, {});

  $: filtered = history.filter((j) => {
    if (stateFilter !== "all" && j.state !== stateFilter) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hay = `${j.id} ${j.request.generator.id} ${j.request.printerId} ${j.request.profileId}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  function chipLabel(s: StateFilter): string {
    if (s === "all") return `All (${history.length})`;
    const n = counts[s] ?? 0;
    return `${s[0].toUpperCase()}${s.slice(1)} (${n})`;
  }
</script>

<div class="page">
  <div class="head">
    <h1>Job history</h1>
    <a href="/" class="navlink">← Back to app</a>
  </div>

  {#if error}<div class="card err">{error}</div>{/if}

  <!-- Per-browser strip, moved here from the home page so job history lives in one
       place. It is NOT redundant with the table below: the table is the server's
       durable record and only contains jobs that have FINISHED, so a job in flight
       appears here and nowhere else. -->
  <section class="card">
    <h2>From this browser</h2>
    <p class="muted">
      Jobs you submitted here, including any still running. Running jobs link to their
      live progress; finished ones link to their details.
    </p>
    <div class="strip"><RecentJobs /></div>
  </section>

  {#if !loaded}
    <p class="muted">Loading…</p>
  {:else}
    <section class="card">
      <div class="secthead">
        <h2>All jobs on this server</h2>
        <span class="live" title="Auto-refreshing">● live</span>
      </div>
      <p class="muted">
        Every job this server has run once it finished, newest first. Refreshes every {REFRESH_MS / 1000}s.
        Click a job id for details.
      </p>

      {#if history.length > 0}
        <div class="controls">
          <div class="chips" role="group" aria-label="Filter by state">
            {#each STATE_FILTERS as s}
              <button
                class="chip"
                class:active={stateFilter === s}
                aria-pressed={stateFilter === s}
                on:click={() => (stateFilter = s)}
              >{chipLabel(s)}</button>
            {/each}
          </div>
          <input
            class="search"
            type="search"
            placeholder="Filter by id, generator, printer, profile…"
            aria-label="Filter jobs"
            bind:value={query}
          />
        </div>
      {/if}

      {#if history.length === 0}
        <p class="muted">No jobs yet. Submit one from the app and it will show up here.</p>
      {:else if filtered.length === 0}
        <p class="muted">No jobs match the current filter.</p>
      {:else}
        <p class="muted resultnote">Showing {filtered.length} of {history.length}.</p>
        <div class="tablewrap"><table>
          <thead><tr><th>When</th><th>Job</th><th>Generator</th><th>Printer</th><th>Profile</th><th>State</th></tr></thead>
          <tbody>
            {#each filtered as j (j.id)}
              <tr>
                <td class="muted">{fmtDate(j.createdAt)}</td>
                <td><a class="mono jobid" href={`/history/${j.id}`}>{j.id.slice(0, 8)}</a></td>
                <td class="mono">{j.request.generator.id}</td>
                <td class="mono">{j.request.printerId || "—"}</td>
                <td class="mono">{j.request.profileId || "—"}</td>
                <td>
                  <span class="state {j.state}">{j.state}</span>
                  {#if j.error}<br /><span class="muted">{j.error.reason}</span>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table></div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .page { display: flex; flex-direction: column; gap: 1.25rem; }
  .head { display: flex; align-items: baseline; justify-content: space-between; }
  h1 { margin: 0; }
  h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 0 0 0.35rem; }
  .secthead { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
  .secthead h2 { margin: 0; }
  .live { font-size: 0.72rem; color: var(--ok); letter-spacing: 0.02em; }
  .controls { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin: 0.75rem 0 0.25rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .chip {
    font-size: 0.8rem; padding: 0.2rem 0.6rem; border-radius: 99px;
    border: 1px solid var(--border); background: transparent; color: var(--muted);
    cursor: pointer; transition: color 0.15s, border-color 0.15s, background 0.15s;
  }
  .chip:hover { color: var(--text); }
  .chip.active { color: var(--accent); border-color: var(--accent); background: var(--surface-2); }
  .chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .search {
    flex: 1; min-width: 12rem; font-size: 0.85rem; padding: 0.35rem 0.6rem;
    border-radius: var(--radius); border: 1px solid var(--border);
    background: var(--bg); color: var(--text);
  }
  .search:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .resultnote { margin: 0.4rem 0 0; font-size: 0.82rem; }
  .strip { margin-top: 0.75rem; }
  .navlink { color: var(--accent); text-decoration: none; }
  .tablewrap { margin-top: 0.75rem; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--border); vertical-align: top; font-size: 0.9rem; }
  th { color: var(--muted); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .mono { font-family: ui-monospace, monospace; font-size: 0.85em; }
  .jobid { color: var(--accent); text-decoration: none; }
  .jobid:hover { text-decoration: underline; }
  .err { color: var(--danger); }
  @media (max-width: 640px) {
    th, td { padding: 0.4rem 0.4rem; font-size: 0.82rem; }
  }
  .state { font-size: 0.8rem; padding: 0.1rem 0.45rem; border-radius: 99px; border: 1px solid var(--border); }
  .state.done { color: var(--ok); border-color: var(--ok); }
  .state.failed, .state.canceled { color: var(--danger); border-color: var(--danger); }
</style>
