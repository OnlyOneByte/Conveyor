<script lang="ts">
  import { onMount } from "svelte";
  import { fetchJobHistory, type JobHistoryEntry } from "$lib/api";
  import RecentJobs from "$lib/components/RecentJobs.svelte";

  // The DURABLE, server-side job history (persisted in SQLite by the worker), as
  // opposed to the per-browser strip on the home page — that one is localStorage and
  // only knows about jobs submitted from this browser.
  let history: JobHistoryEntry[] = [];
  let error: string | null = null;
  let loaded = false;

  async function reload() {
    try {
      history = await fetchJobHistory();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loaded = true;
    }
  }
  onMount(reload);

  function fmtDate(ms: number): string {
    return new Date(ms).toLocaleString();
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
      <h2>All jobs on this server</h2>
      <p class="muted">Every job this server has run once it finished, newest first. Click a job id for details.</p>
      {#if history.length === 0}
        <p class="muted">No jobs yet. Submit one from the app and it will show up here.</p>
      {:else}
        <div class="tablewrap"><table>
          <thead><tr><th>When</th><th>Job</th><th>Generator</th><th>Printer</th><th>Profile</th><th>State</th></tr></thead>
          <tbody>
            {#each history as j}
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
