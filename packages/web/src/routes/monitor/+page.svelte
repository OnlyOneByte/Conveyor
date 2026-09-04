<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    fetchActiveJobs,
    fetchCatalogPrinters,
    fetchPrinterReachable,
    cancelJob,
    type JobStatusEvent,
    type CatalogPrinter,
    type PrinterReachable,
  } from "$lib/api";

  // Live monitoring: two independent polls. Active jobs churn fast (2s); printer
  // reachability is a network probe, so it runs slower (15s) to avoid hammering the
  // fleet. A `now` ticker (1s) drives the "elapsed in current stage" counters without
  // re-fetching. All three are cleared on destroy.
  const ACTIVE_MS = 2000;
  const REACH_MS = 15000;

  let jobs: JobStatusEvent[] = [];
  let printers: CatalogPrinter[] = [];
  let reach: Record<string, PrinterReachable | "checking"> = {};
  let jobsError: string | null = null;
  let loaded = false;
  let now = Date.now();

  let activeTimer: ReturnType<typeof setInterval> | undefined;
  let reachTimer: ReturnType<typeof setInterval> | undefined;
  let clockTimer: ReturnType<typeof setInterval> | undefined;

  const STAGE_LABEL: Record<string, string> = {
    generator: "Generating",
    slicer: "Slicing",
    transport: "Transferring",
  };

  async function pollJobs() {
    try {
      jobs = await fetchActiveJobs();
      jobsError = null;
    } catch (e) {
      jobsError = (e as Error).message;
    } finally {
      loaded = true;
    }
  }

  async function pollReach() {
    // Refresh the printer list too, so a printer added in Settings shows up here.
    try {
      printers = await fetchCatalogPrinters();
    } catch {
      /* leave the last-known list; a transient list error shouldn't blank the grid */
    }
    await Promise.all(
      printers.map(async (p) => {
        reach = { ...reach, [p.id]: "checking" };
        try {
          const r = await fetchPrinterReachable(p.id);
          reach = { ...reach, [p.id]: r };
        } catch {
          reach = { ...reach, [p.id]: { reachable: false, host: p.address, port: 0, reason: "probe failed" } };
        }
      }),
    );
  }

  onMount(() => {
    void pollJobs();
    void pollReach();
    activeTimer = setInterval(pollJobs, ACTIVE_MS);
    reachTimer = setInterval(pollReach, REACH_MS);
    clockTimer = setInterval(() => (now = Date.now()), 1000);
  });
  onDestroy(() => {
    clearInterval(activeTimer);
    clearInterval(reachTimer);
    clearInterval(clockTimer);
  });

  /** Milliseconds spent in the job's currently-open stage (the last timing entry). */
  function currentStageElapsed(j: JobStatusEvent): number | null {
    const open = j.timings?.find((t) => t.durationMs === undefined);
    return open ? Math.max(0, now - open.enteredAt) : null;
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
      await pollJobs();
    } catch (e) {
      jobsError = (e as Error).message;
    } finally {
      cancelling = { ...cancelling, [jobId]: false };
    }
  }
</script>

<div class="page">
  <div class="head">
    <h1>Monitor</h1>
    <a href="/" class="navlink">← Back to app</a>
  </div>

  <!-- ── Active jobs ─────────────────────────────────────────────────────── -->
  <section class="card">
    <div class="secthead">
      <h2>Active jobs</h2>
      <span class="live" title="Auto-refreshing">● live</span>
    </div>
    <p class="muted">
      Jobs in flight right now — anyone's, not just this browser's. Updates every {ACTIVE_MS / 1000}s.
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
              <a class="mono jobid" href={`/history/${j.jobId}`} title="Open job details">{j.jobId.slice(0, 8)}</a>
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
              <div class="bar"><div class="fill" style={`width:${Math.round(j.progress * 100)}%`} /></div>
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

  <!-- ── Printers ────────────────────────────────────────────────────────── -->
  <section class="card">
    <div class="secthead">
      <h2>Printers</h2>
      <span class="live" title="Re-probed periodically">● live</span>
    </div>
    <p class="muted">
      Reachability of each registered printer (a TCP connect to its address). Re-checked every {REACH_MS / 1000}s.
    </p>

    {#if printers.length === 0}
      <p class="muted empty">
        No printers registered. Add one under <a class="inlink" href="/settings">Settings</a>.
      </p>
    {:else}
      <div class="tablewrap"><table>
        <thead><tr><th>Printer</th><th>Transport</th><th>Address</th><th>Reachable</th></tr></thead>
        <tbody>
          {#each printers as p (p.id)}
            {@const r = reach[p.id]}
            <tr>
              <td>{p.name}</td>
              <td class="mono">{p.transportId}</td>
              <td class="mono addr">{p.address}</td>
              <td>
                {#if r === undefined || r === "checking"}
                  <span class="dot checking" /> <span class="muted">checking…</span>
                {:else if r.reachable}
                  <span class="dot ok" /> <span class="reachok">online</span>
                  {#if r.latencyMs != null}<span class="muted"> · {r.latencyMs}ms</span>{/if}
                {:else}
                  <span class="dot down" /> <span class="reachdown">offline</span>
                  {#if r.reason}<span class="muted"> · {r.reason}</span>{/if}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table></div>
    {/if}
  </section>
</div>

<style>
  .page { display: flex; flex-direction: column; gap: 1.25rem; }
  .head { display: flex; align-items: baseline; justify-content: space-between; }
  h1 { margin: 0; }
  h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 0; }
  .secthead { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
  .navlink { color: var(--accent); text-decoration: none; }
  .inlink { color: var(--accent); text-decoration: none; }
  .inlink:hover { text-decoration: underline; }
  .live { font-size: 0.72rem; color: var(--ok); letter-spacing: 0.02em; }
  .muted { color: var(--muted); }
  .empty { margin-top: 0.5rem; }
  .err { color: var(--danger); }

  .jobs { list-style: none; margin: 0.75rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.75rem; }
  .jobs li { border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem 0.75rem; display: flex; flex-direction: column; gap: 0.4rem; }
  .jobmain { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
  .jobactions { display: flex; justify-content: flex-end; }
  .mono { font-family: ui-monospace, monospace; font-size: 0.85em; }
  .jobid { color: var(--accent); text-decoration: none; }
  .jobid:hover { text-decoration: underline; }
  .elapsed { font-size: 0.85rem; }
  .small { min-height: 30px; padding: 0.15rem 0.55rem; font-size: 0.78rem; }

  .timings { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .timing {
    font-size: 0.75rem; color: var(--muted);
    border: 1px solid var(--border); border-radius: 99px; padding: 0.08rem 0.5rem;
  }
  .timing b { color: var(--text); font-weight: 600; }
  .timing.open { border-color: var(--accent); color: var(--accent); }
  .timing.open b { color: var(--accent); }

  .bar { height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden; }
  .fill { height: 100%; background: var(--accent); transition: width 0.3s; }

  .tablewrap { margin-top: 0.75rem; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--border); font-size: 0.9rem; vertical-align: middle; }
  th { color: var(--muted); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .addr { word-break: break-all; }

  .state { font-size: 0.8rem; padding: 0.1rem 0.45rem; border-radius: 99px; border: 1px solid var(--border); }
  .state.printing, .state.generating, .state.slicing, .state.transferring { color: var(--accent); border-color: var(--accent); }
  .state.queued { color: var(--muted); }

  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; vertical-align: middle; }
  .dot.ok { background: var(--ok); }
  .dot.down { background: var(--danger); }
  .dot.checking { background: var(--border); animation: pulse 1s infinite; }
  .reachok { color: var(--ok); }
  .reachdown { color: var(--danger); }
  @keyframes pulse { 50% { opacity: 0.3; } }

  @media (max-width: 640px) {
    th, td { padding: 0.4rem 0.4rem; font-size: 0.82rem; }
  }
</style>
