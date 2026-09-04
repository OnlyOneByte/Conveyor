<script lang="ts">
  import { goto } from "$app/navigation";
  import { stashRerun } from "$lib/rerun";
  import type { PageData } from "./$types";

  export let data: PageData;

  $: job = data.job;

  function fmtDate(ms: number): string {
    return new Date(ms).toLocaleString();
  }

  /** Pretty-print the generator params. They are arbitrary per-generator JSON. */
  function fmtParams(params: unknown): string {
    if (params === undefined || params === null) return "(none)";
    return JSON.stringify(params, null, 2);
  }

  let copied = false;
  async function copyId() {
    try {
      await navigator.clipboard.writeText(data.jobId);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // Clipboard is unavailable over plain http on some browsers; the id is
      // selectable text either way, so this is a convenience, not the mechanism.
    }
  }

  /**
   * Re-run this job: stash its request and go to the home page, which reads the stash
   * and pre-fills the submit form. It does NOT auto-submit — the user reviews (and can
   * tweak) params first. A passthrough (uploaded STL) job cannot be re-run this way:
   * its "params" reference an uploadId that no longer exists, so the button is hidden.
   */
  async function runAgain() {
    if (!job) return;
    stashRerun({
      generatorId: job.request.generator.id,
      params: job.request.generator.params,
      printerId: job.request.printerId,
      profileId: job.request.profileId,
    });
    await goto("/?rerun=1");
  }

  // Human duration for a persisted per-stage timing.
  function fmtDuration(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem ? `${m}m ${rem}s` : `${m}m`;
  }
  const STAGE_LABEL: Record<string, string> = {
    generator: "Generating",
    slicer: "Slicing",
    transport: "Transferring",
  };
</script>

<div class="page">
  <div class="head">
    <h1>Job</h1>
    <a href="/history" class="navlink">← All jobs</a>
  </div>

  <section class="card">
    <div class="idrow">
      <span class="mono id">{data.jobId}</span>
      <button class="ghost small" on:click={copyId}>{copied ? "Copied" : "Copy id"}</button>
      {#if job && job.request.generator.id !== "passthrough" && job.request.printerId && job.request.profileId}
        <button class="primary small" on:click={runAgain} title="Pre-fill the submit form with this job's settings">
          Run again
        </button>
      {/if}
    </div>

    {#if !job}
      <!-- Not an error: only TERMINAL jobs get a durable row (the worker records on
           done/failed), so a job still running genuinely is not here yet. -->
      <p class="muted notfound">
        No settled job with this id. Jobs are recorded when they finish, so a job that is
        still running will not appear here until it completes.
      </p>
    {:else}
      <dl class="facts">
        <dt>State</dt>
        <dd>
          <span class="state {job.state}">{job.state}</span>
          {#if job.stage}<span class="muted"> at stage <span class="mono">{job.stage}</span></span>{/if}
        </dd>

        <dt>Finished</dt>
        <dd class="muted">{fmtDate(job.createdAt)}</dd>

        <dt>Printer</dt>
        <dd class="mono">{job.request.printerId || "—"}</dd>

        <dt>Profile</dt>
        <dd class="mono">{job.request.profileId || "—"}</dd>

        <dt>Generator</dt>
        <dd class="mono">{job.request.generator.id}</dd>
      </dl>

      {#if job.error}
        <div class="failure">
          <strong>Failed during {job.error.stage}</strong>
          <p class="reason">{job.error.reason}</p>
        </div>
      {/if}

      {#if job.timings && job.timings.length}
        <h2>Timings</h2>
        <dl class="facts">
          {#each job.timings as t}
            <dt>{STAGE_LABEL[t.stage] ?? t.stage}</dt>
            <dd class="muted">{t.durationMs === undefined ? "—" : fmtDuration(t.durationMs)}</dd>
          {/each}
        </dl>
      {/if}

      <h2>Parameters</h2>
      <pre class="mono block">{fmtParams(job.request.generator.params)}</pre>

      <h2>Artifacts</h2>
      {#if job.artifacts?.model || job.artifacts?.gcode}
        <div class="downloads">
          {#if job.artifacts.model}
            <a class="dl" href={`/jobs/${encodeURIComponent(data.jobId)}/artifact/model`} download>
              ↓ Model (STL)
            </a>
          {/if}
          {#if job.artifacts.gcode}
            <a class="dl" href={`/jobs/${encodeURIComponent(data.jobId)}/artifact/gcode`} download>
              ↓ G-code
            </a>
          {/if}
        </div>
        <p class="muted note">
          Downloads stream from the server's data volume. If a file has been reclaimed the
          link returns "no longer on disk".
        </p>
      {:else}
        <p class="muted">None recorded — the run did not get far enough to produce files.</p>
      {/if}
    {/if}
  </section>
</div>

<style>
  .page { display: flex; flex-direction: column; gap: 1.25rem; }
  .head { display: flex; align-items: baseline; justify-content: space-between; }
  h1 { margin: 0; }
  h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 1.25rem 0 0.4rem; }
  .navlink { color: var(--accent); text-decoration: none; }
  .idrow { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  .id { font-size: 0.9rem; word-break: break-all; }
  .small { min-height: 32px; padding: 0.2rem 0.55rem; font-size: 0.8rem; }
  .primary {
    background: var(--accent); color: var(--bg); border: 1px solid var(--accent);
    border-radius: var(--radius); cursor: pointer; font-weight: 600;
  }
  .primary:hover { background: var(--accent-hover, var(--accent)); }
  .downloads { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.35rem; }
  .dl {
    display: inline-flex; align-items: center; gap: 0.3rem;
    padding: 0.35rem 0.7rem; border-radius: var(--radius);
    border: 1px solid var(--accent); color: var(--accent); text-decoration: none;
    font-size: 0.85rem; transition: background 0.15s;
  }
  .dl:hover { background: var(--surface-2); }
  .mono { font-family: ui-monospace, monospace; font-size: 0.85em; }
  .wrap { word-break: break-all; }
  .notfound { margin: 0.9rem 0 0; }
  .facts { display: grid; grid-template-columns: max-content 1fr; gap: 0.35rem 1rem; margin: 0.9rem 0 0; }
  .facts dt { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .facts dd { margin: 0; }
  .block { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 0.6rem 0.7rem; overflow-x: auto; margin: 0; }
  .state { font-size: 0.8rem; padding: 0.1rem 0.45rem; border-radius: 99px; border: 1px solid var(--border); }
  .state.done { color: var(--ok); border-color: var(--ok); }
  .state.failed, .state.canceled { color: var(--danger); border-color: var(--danger); }
  .failure { margin-top: 1rem; border: 1px solid var(--danger); border-radius: 6px; padding: 0.6rem 0.7rem; }
  .failure strong { color: var(--danger); }
  .reason { margin: 0.3rem 0 0; }
  .note { margin: 0.4rem 0 0; font-size: 0.85em; }
</style>
