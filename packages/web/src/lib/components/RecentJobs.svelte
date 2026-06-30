<script lang="ts">
  import { onMount } from "svelte";
  import { fetchJobSnapshot } from "$lib/api";
  import { recentJobs, updateJobState, type RecentJob } from "$lib/recent-jobs";

  // Jobs submitted from THIS browser, persisted across refreshes (localStorage).
  // On mount we reconcile each remembered job with its server snapshot so a
  // reload reflects the latest state, not the state at submit time. Snapshots
  // live in Redis and may have expired — in that case we keep the last-known
  // state rather than dropping the row.
  export let activeJobId: string | null = null;
  export let onSelect: (jobId: string) => void = () => {};

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
</script>

{#if $recentJobs.length}
  <ul class="recent">
    {#each $recentJobs as j (j.jobId)}
      <li>
        <button
          type="button"
          class="job"
          class:active={j.jobId === activeJobId}
          on:click={() => onSelect(j.jobId)}
          title={j.jobId}
        >
          <span class="state {stateClass(j.state)}">{j.state}</span>
          <span class="meta">
            <span class="gen">{j.generatorId}</span>
            <span class="muted">{j.stationName}</span>
          </span>
          <span class="when muted">{relTime(j.submittedAt)}</span>
        </button>
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
  }
  .job:hover { border-color: var(--accent-dim); }
  .job.active { border-color: var(--accent); background: rgba(94, 234, 212, 0.08); }
  .state { font-size: 0.7rem; padding: 0.1rem 0.45rem; border-radius: 99px; border: 1px solid var(--border); text-transform: capitalize; flex-shrink: 0; }
  .state.done { color: var(--ok); border-color: var(--ok); }
  .state.bad { color: var(--danger); border-color: var(--danger); }
  .state.live { color: var(--accent); border-color: var(--accent-dim); }
  .meta { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
  .gen { font-size: 0.85rem; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .when { margin-left: auto; font-size: 0.75rem; flex-shrink: 0; }
  .empty { font-size: 0.85rem; margin: 0; }
</style>
