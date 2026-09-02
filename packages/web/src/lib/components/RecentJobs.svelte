<script lang="ts">
  import { onMount } from "svelte";
  import { fetchJobSnapshot } from "$lib/api";
  import { recentJobs, updateJobState, type RecentJob } from "$lib/recent-jobs";

  // Jobs submitted from THIS browser, persisted across refreshes (localStorage).
  // On mount we reconcile each remembered job with its server snapshot so a
  // reload reflects the latest state, not the state at submit time. Snapshots
  // live in Redis and may have expired — in that case we keep the last-known
  // state rather than dropping the row.
  //
  // Each entry is a LINK, and where it points depends on whether the job has
  // settled. Only terminal jobs get a durable row, so /history/<id> would show
  // "no settled job" for one still running; those link to the home page's live
  // status panel instead, which is the only place a running job can be watched.

  const TERMINAL = new Set(["done", "failed", "canceled"]);

  onMount(async () => {
    const jobs = $recentJobs;
    await Promise.all(
      jobs
        .filter((j) => !TERMINAL.has(j.state)) // settled jobs won't change
        .map(async (j) => {
          const snap = await fetchJobSnapshot(j.jobId).catch(() => null);
          if (snap) updateJobState(j.jobId, snap.state);
        }),
    );
  });

  function relTime(ms: number): string {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function stateClass(state: RecentJob["state"]): string {
    if (state === "done") return "done";
    if (state === "failed" || state === "canceled") return "bad";
    return "live";
  }

  const isSettled = (state: RecentJob["state"]) => TERMINAL.has(state);
  const hrefFor = (j: RecentJob) => (isSettled(j.state) ? `/history/${j.jobId}` : `/?job=${j.jobId}`);
</script>

{#if $recentJobs.length}
  <ul class="recent">
    {#each $recentJobs as j (j.jobId)}
      <li>
        <a
          class="job"
          href={hrefFor(j)}
          title={isSettled(j.state) ? `${j.jobId} — view details` : `${j.jobId} — watch live progress`}
        >
          <span class="state {stateClass(j.state)}">{j.state}</span>
          <span class="meta">
            <span class="gen">{j.generatorId}</span>
            <span class="muted">{j.stationName}</span>
          </span>
          <span class="when muted">{relTime(j.submittedAt)}</span>
          <span class="go muted">{isSettled(j.state) ? "details →" : "watch →"}</span>
        </a>
      </li>
    {/each}
  </ul>
{:else}
  <p class="muted empty">No jobs submitted from this browser yet.</p>
{/if}

<style>
  .recent { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .job {
    display: flex; align-items: center; gap: 0.6rem; width: 100%; text-align: left;
    border: 1px solid var(--border); background: var(--surface-2); border-radius: 8px; padding: 0.45rem 0.6rem;
    text-decoration: none; color: inherit;
  }
  .job:hover { border-color: var(--accent-dim); }
  .state { font-size: 0.7rem; padding: 0.1rem 0.45rem; border-radius: 99px; border: 1px solid var(--border); text-transform: capitalize; flex-shrink: 0; }
  .state.done { color: var(--ok); border-color: var(--ok); }
  .state.bad { color: var(--danger); border-color: var(--danger); }
  .state.live { color: var(--accent); border-color: var(--accent-dim); }
  .meta { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
  .gen { font-size: 0.85rem; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .when { margin-left: auto; font-size: 0.75rem; flex-shrink: 0; }
  .go { font-size: 0.75rem; flex-shrink: 0; }
  .empty { font-size: 0.85rem; margin: 0; }
</style>
