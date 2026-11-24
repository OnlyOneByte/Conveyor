<script lang="ts">
  import { Canvas } from "@threlte/core";
  import { ACESFilmicToneMapping } from "three";
  import { goto } from "$app/navigation";
  import { titled } from "#lib/belt.js";
  import JobReceipt from "#lib/components/JobReceipt.svelte";
  import PreviewScene from "#lib/components/PreviewScene.svelte";
  import { failureText } from "#lib/job-failure.js";
  import { isRecord, jobName, settingRows } from "#lib/job-settings.js";
  import { rerunRequest, stashRerun } from "#lib/rerun.js";
  import type { PageData } from "./$types";

  export let data: PageData;

  const PILL = { done: "Printed", failed: "Failed", canceled: "Canceled" } as const;
  const WHEN = { done: "Finished", failed: "Stopped", canceled: "Canceled" } as const;

  $: job = data.job;
  $: gen = data.generator;
  $: params = job?.request.generator.params;
  $: schema = gen?.paramSchema ?? null;
  $: rows = job ? settingRows(params, schema, gen?.ui ?? null) : [];
  $: fallback = job ? titled(job.request.generator.id) : "";
  $: name = job ? jobName(gen?.name ?? fallback, params, schema, gen?.ui ?? null) : "";
  $: title = name || (data.live ? "This job is still running" : "We can't find that job");
  $: state = job?.state === "done" || job?.state === "failed" || job?.state === "canceled"
    ? job.state
    : null;
  $: failure = job?.error ? failureText(job.error.stage, job.error.reason) : null;
  $: rerun = job ? rerunRequest(job) : null;
  $: when = job
    ? new Date(job.updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "";

  async function again() {
    if (!rerun) return;
    const { generator, printerId, profileId } = rerun;
    stashRerun({ generatorId: generator.id, params: generator.params, printerId, profileId });
    await goto("/?rerun=1");
  }
</script>

<svelte:head><title>{title} · Conveyor</title></svelte:head>

{#if !job}
  <section class="nf" aria-labelledby="job-title">
    <h1 id="job-title">{title}</h1>
    {#if data.live}
      <p>Follow its progress on the Monitor page until it finishes.</p>
      <div class="acts"><a class="btn primary" href="/monitor">Open Monitor</a></div>
    {:else}
      <p>It may have been removed, or the link is mistyped.</p>
      <div class="acts">
        <a class="btn primary" href="/history">See your jobs</a>
        <a class="btn" href="/">Go to Make</a>
      </div>
    {/if}
  </section>
{:else}
  <a class="crumb" href="/history">← Jobs</a>
  <div class="head">
    <div class="t">
      <h1 id="job-title">{title}</h1>
      <p class="meta">
        {#if state}<span class="pill {state}">{PILL[state]}</span>{/if}
        <span>{[data.printer, data.profile].filter(Boolean).join(" · ")}</span>
        {#if state}<span>{WHEN[state]} {when}</span>{/if}
      </p>
    </div>
    {#if rerun}
      <div class="acts">
        <button class="btn primary" type="button" on:click={again}>
          Print again
        </button>
      </div>
    {/if}
  </div>
  {#if failure}
    <div class="why" role="note"><strong>{failure.title}</strong><p>{failure.detail}</p></div>
  {/if}
  <div class="grid">
    <div class="mat">
      {#if gen?.preview?.module === "gridfinity"}
        <Canvas toneMapping={ACESFilmicToneMapping}>
          <PreviewScene params={isRecord(params) ? params : {}} />
        </Canvas>
      {:else}
        <span class="tag">{title}</span>
      {/if}
    </div>
    <JobReceipt {job} {rows} />
  </div>
{/if}

<style>
  h1 { margin: 0; font-size: var(--fs-title); line-height: 1.05; letter-spacing: -0.04em; }
  p { margin: 0; }
  .crumb { font-weight: 600; color: var(--muted); text-decoration: none; }
  .head {
    display: flex; align-items: flex-start; gap: var(--s4); flex-wrap: wrap;
    margin: var(--s2) 0 var(--s5);
  }
  .t { flex: 1; min-width: 260px; display: flex; flex-direction: column; gap: var(--s2); }
  .meta {
    display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2) var(--s3);
    color: var(--muted);
  }
  .pill {
    display: inline-flex; align-items: center; min-height: 28px; padding: 0 10px;
    border: 1.5px solid currentColor; border-radius: 99px; font-weight: 700;
  }
  .pill.done { color: var(--ok); }
  .pill.failed { color: var(--err); }
  .pill.canceled { color: var(--off); }
  .acts { display: flex; gap: var(--s2); flex-wrap: wrap; }
  .btn {
    min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body);
    text-decoration: none; border-color: var(--field-line);
  }
  .btn.primary { border-color: var(--accent); }
  .why {
    margin-bottom: var(--s5); padding: var(--s4); border: 1.5px solid var(--err);
    border-radius: var(--r-card); background: color-mix(in oklch, var(--err) 10%, transparent);
  }
  .why strong { display: block; color: var(--err); font-size: 17px; }
  .grid {
    display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    gap: var(--s5); align-items: start;
  }
  .mat {
    position: relative; aspect-ratio: 4 / 3; display: grid; place-items: center;
    overflow: hidden; border-radius: var(--r-panel); background: var(--mat);
  }
  .tag {
    padding: 4px 10px; border-radius: 99px; background: var(--paper); font: 500 12px var(--mono);
  }
  .nf { max-width: 520px; display: flex; flex-direction: column; gap: var(--s4); padding: 10vh 0; }
  @media (max-width: 759px) {
    .grid { grid-template-columns: 1fr; }
    .head .acts { width: 100%; }
    .head .btn { flex: 1; }
  }
</style>
