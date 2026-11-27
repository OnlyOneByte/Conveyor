<script lang="ts">
  import { announce } from "#lib/announce.js";
  import { API, type JobHistoryEntry } from "#lib/api.js";
  import { readNote } from "#lib/job-notes.js";
  import { duration, type SettingRow } from "#lib/job-settings.js";
  import ErrorDetails from "./ErrorDetails.svelte";

  export let job: Pick<JobHistoryEntry, "id" | "state"> & Partial<JobHistoryEntry>;
  export let rows: SettingRow[];

  const STEP: Record<string, string> = {
    generator: "Model",
    slicer: "Slice",
    transport: "Send to printer",
  };

  $: id = encodeURIComponent(job.id);
  $: note = readNote(job.notes);
  $: times = job.timings?.filter((t) => t.durationMs !== undefined) ?? [];
  $: took = times.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
  $: used = [
    job.filament?.grams === undefined ? "" : `${job.filament.grams} g`,
    job.filament?.metres === undefined ? "" : `${job.filament.metres} m`,
  ].filter(Boolean);

  let copied = false;
  async function copyId() {
    await navigator.clipboard.writeText(job.id).then(
      () => {
        copied = true;
        announce("Job ID copied");
      },
      () => announce("Couldn't copy. Open Details to select the ID instead."),
    );
    setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="receipt">
  <slot />
  {#if note}
    <section class="note">
      <h2>Note</h2>
      <p>{note.plain.join(" ")}</p>
      <ErrorDetails detail={note.raw} />
    </section>
  {/if}
  {#if rows.length}
    <section>
      <h2>Settings</h2>
      <dl>
        {#each rows as row (row.key)}<dt>{row.label}</dt><dd>{row.value}</dd>{/each}
      </dl>
    </section>
  {/if}
  {#if times.length}
    <section>
      <h2>Stage times</h2>
      <dl>
        {#each times as t (t.stage)}
          <dt>{STEP[t.stage] ?? "Step"}</dt><dd>{duration(t.durationMs ?? 0)}</dd>
        {/each}
        {#if job.state === "done"}
          <dt class="total">Took</dt><dd class="total">{duration(took)}</dd>
        {/if}
      </dl>
    </section>
  {/if}
  {#if used.length}
    <section>
      <h2>Filament</h2>
      <dl><dt>Used</dt><dd>{used.join(" · ")}</dd></dl>
    </section>
  {/if}
  {#if job.artifacts?.model || job.artifacts?.gcode || job.artifacts?.log}
    <section>
      <h2>Files</h2>
      {#if job.filesRemovedAfterDays}
        <p class="gone">Files removed after {job.filesRemovedAfterDays} days.</p>
      {:else}
      <div class="files">
        {#if job.artifacts.model}
          <a class="btn" href={`${API}/jobs/${id}/artifact/model`} download>Model (STL)</a>
        {/if}
        {#if job.artifacts.gcode}
          <a class="btn" href={`${API}/jobs/${id}/artifact/gcode`} download>G-code</a>
        {/if}
        {#if job.artifacts.log}
          <a class="btn" href={`${API}/jobs/${id}/artifact/log`} download>Engine log</a>
        {/if}
      </div>
      {/if}
    </section>
  {/if}
  <details>
    <summary>Details</summary>
    <pre>Job ID: {job.id}{job.error ? `\n${job.error.stage}: ${job.error.reason}` : ""}</pre>
  </details>
  <div class="idrow">
    <span>Job ID</span>
    <button class="btn" type="button" on:click={copyId}>{copied ? "Copied" : "Copy job ID"}</button>
  </div>
  <slot name="end" />
</div>

<style>
  .receipt {
    display: flex; flex-direction: column; gap: var(--s5); padding: var(--s5);
    border: 1px solid var(--line); border-top: 2px dashed var(--field-line);
    border-radius: var(--r-card); background: var(--paper);
  }
  .receipt :global(h2) {
    margin: 0 0 var(--s2); font: 500 var(--fs-label) var(--mono);
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted);
  }
  dl { display: grid; grid-template-columns: 1fr auto; gap: var(--s1-5) var(--s4); margin: 0; }
  dt { color: var(--muted); }
  dd { margin: 0; text-align: right; font: 500 var(--fs-body) var(--mono); }
  .total { padding-top: var(--s1-5); border-top: 1.5px dashed var(--field-line); font-weight: 700; }
  dt.total { color: var(--ink); }
  .note p {
    margin: 0; padding: var(--s3) var(--s4); border-left: 3px solid var(--field-line);
    border-radius: 0 var(--r-inner) var(--r-inner) 0; background: var(--sunk); white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .files { display: flex; gap: var(--s2); flex-wrap: wrap; }
  .gone { margin: 0; color: var(--muted); }
  .btn {
    min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body);
    text-decoration: none; border-color: var(--field-line);
  }
  summary { padding: var(--s1-5) 0; font-weight: 600; color: var(--muted); cursor: pointer; }
  @media (pointer: coarse) { summary { padding: var(--s3) 0; } }
  pre {
    margin: var(--s2) 0 0; padding: var(--s3); border-radius: var(--r-inner); background: var(--sunk);
    font: 500 var(--fs-mono) var(--mono); white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .idrow { display: flex; align-items: center; gap: var(--s3); color: var(--muted); }
</style>
