<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { activeJobs, watchActive } from "#lib/active-jobs.js";
  import { POLL_MS } from "#lib/belt.js";
  import { OFFLINE } from "#lib/track.js";
  import {
    cancelJob,
    type JobStatusEvent,
  } from "#lib/api.js";

  let now = Date.now();
  $: jobs = $activeJobs?.jobs ?? [];
  let cancelError: string | null = null;
  $: jobsError = $activeJobs?.ok === false ? OFFLINE : cancelError;
  $: loaded = $activeJobs !== null;

  let clockTimer: ReturnType<typeof setInterval> | undefined;

  const STAGE_LABEL: Record<string, string> = {
    generator: "Generating",
    slicer: "Slicing",
    transport: "Transferring",
  };

  onMount(watchActive);
  onMount(() => {
    clockTimer = setInterval(() => (now = Date.now()), 1000);
  });
  onDestroy(() => {
    clearInterval(clockTimer);
  });

  /** Milliseconds spent in the job's currently-open stage (the last timing entry). */
  function currentStageElapsed(j: JobStatusEvent): number | null {
    const open = j.timings?.find((t) => t.durationMs === undefined);
    if (!open) return null;
    const ms = now - open.enteredAt;
    // Sanity clamp: a real worker stamps enteredAt with Date.now(), so an elapsed
    // over ~24h (or negative) means a bad/clock-skewed timestamp, not a day-long
    // stage — suppress it rather than render a nonsensical counter.
    if (ms < 0 || ms > 24 * 60 * 60 * 1000) return null;
    return ms;
  }

  function fmtDuration(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem ? `${m}m ${rem}s` : `${m}m`;
  }

  function stageLabel(j: JobStatusEvent): string {
    if (j.state === "printing") return "Printing";
    if (j.state === "queued") return "Queued";
    return (j.stage && STAGE_LABEL[j.stage]) || j.state;
  }

  let cancelling: Record<string, boolean> = {};
  async function onCancel(jobId: string) {
    cancelling = { ...cancelling, [jobId]: true };
    try {
      await cancelJob(jobId);
      cancelError = null;
    } catch (e) {
      cancelError = (e as Error).message;
    } finally {
      cancelling = { ...cancelling, [jobId]: false };
    }
  }
</script>

<svelte:head><title>Monitor · Conveyor</title></svelte:head>
<div class="page">
  <div class="head">
    <h1>Monitor</h1>
  </div>

  <!-- ── Active jobs ─────────────────────────────────────────────────────── -->
  <section class="card">
    <div class="secthead">
      <h2>Active jobs</h2>
      <span class="live" title="Auto-refreshing">● live</span>
    </div>
    <p class="muted">
      Jobs in flight right now — anyone's, not just this browser's. Updates every {POLL_MS / 1000}s.
    </p>

    {#if jobsError}<p class="err">{jobsError}</p>{/if}

    {#if !loaded}
      <p class="muted">Loading…</p>
    {:else if jobs.length === 0}
      <p class="muted empty">Nothing running. Submit a job and it will appear here while it works.</p>
    {:else}
      <ul class="jobs">
        {#each jobs as j (j.jobId)}
          {@const elapsed = currentStageElapsed(j)}
          <li>
            <div class="jobmain">
              <a class="mono jobid" href={`/jobs/${j.jobId}`} title="Open job details">{j.jobId.slice(0, 8)}</a>
              <span class="state {j.state}">{stageLabel(j)}</span>
              {#if elapsed !== null}<span class="muted elapsed">{fmtDuration(elapsed)} in stage</span>{/if}
              {#if j.state === "printing" && j.progress != null}
                <span class="muted">· {Math.round(j.progress * 100)}%</span>
              {/if}
            </div>
            {#if j.timings && j.timings.length}
              <div class="timings">
                {#each j.timings as t}
                  <span class="timing" class:open={t.durationMs === undefined}>
                    {STAGE_LABEL[t.stage] ?? t.stage}
                    <b>{t.durationMs === undefined ? "…" : fmtDuration(t.durationMs)}</b>
                  </span>
                {/each}
              </div>
            {/if}
            {#if j.state === "printing" && j.progress != null}
              <div class="bar"><div class="fill" style={`width:${Math.round(j.progress * 100)}%`}></div></div>
            {/if}
            <div class="jobactions">
              <button class="ghost small" on:click={() => onCancel(j.jobId)} disabled={cancelling[j.jobId]}>
                {cancelling[j.jobId] ? "Cancelling…" : "Cancel"}
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

</div>

<style>
  .page { display: flex; flex-direction: column; gap: 1.25rem; }
  .head { display: flex; align-items: baseline; justify-content: space-between; }
  h1 { margin: 0; }
  h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 0; }
  .secthead { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
  .live { font-size: 0.72rem; color: var(--ok); letter-spacing: 0.02em; }
  .muted { color: var(--muted); }
  .empty { margin-top: 0.5rem; }
  .err { color: var(--danger); }

  .jobs { list-style: none; margin: 0.75rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.75rem; }
  .jobs li { border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem 0.75rem; display: flex; flex-direction: column; gap: 0.4rem; }
  .jobmain { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
  .jobactions { display: flex; justify-content: flex-end; }
  .mono { font-family: ui-monospace, monospace; font-size: 0.85em; }
  .jobid { color: var(--live); text-decoration: none; }
  @media (hover: hover) { .jobid:hover { text-decoration: underline; } }
  .elapsed { font-size: 0.85rem; }
  .small { min-height: 30px; padding: 0.15rem 0.55rem; font-size: 0.78rem; }

  .timings { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .timing {
    font-size: 0.75rem; color: var(--muted);
    border: 1px solid var(--border); border-radius: 99px; padding: 0.08rem 0.5rem;
  }
  .timing b { color: var(--text); font-weight: 600; }
  .timing.open { border-color: var(--accent); color: var(--live); }
  .timing.open b { color: var(--live); }

  .bar { height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden; }
  .fill { height: 100%; background: var(--accent); transition: width 0.3s; }


  .state { font-size: 0.8rem; padding: 0.1rem 0.45rem; border-radius: 99px; border: 1px solid var(--border); }
  .state.printing, .state.generating, .state.slicing, .state.transferring { color: var(--live); border-color: var(--accent); }
  .state.queued { color: var(--muted); }

</style>
