<script lang="ts">
  import { Canvas } from "@threlte/core";
  import { ACESFilmicToneMapping } from "three";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { titled } from "#lib/belt.js";
  import JobHead from "#lib/components/JobHead.svelte";
  import JobReceipt from "#lib/components/JobReceipt.svelte";
  import PreviewScene from "#lib/components/PreviewScene.svelte";
  import { failureText } from "#lib/job-failure.js";
  import { isRecord, jobName, settingRows } from "#lib/job-settings.js";
  import { rerunRequest, stashRerun } from "#lib/rerun.js";
  import type { PageData } from "./$types";

  export let data: PageData;

  const PILL = { done: "Printed", failed: "Failed", canceled: "Canceled" } as const;
  const WHEN = { done: "Finished", failed: "Stopped", canceled: "Canceled" } as const;
  const DATE = { dateStyle: "medium", timeStyle: "short" } as const;

  $: job = data.job;
  $: watch = `/?job=${encodeURIComponent(page.params.id ?? "")}`;
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
  $: retryOf = job?.state === "failed" && job.request.generator.id !== "passthrough"
    && job.request.printerId && job.request.profileId ? job.id : undefined;
  $: rerun = job ? (rerunRequest(job) ?? (retryOf ? job.request : null)) : null;
  $: stamp = job ? new Date(job.updatedAt).toLocaleString([], DATE) : "";
  $: when = state ? `${WHEN[state]} ${stamp}` : "";
  $: meta = [data.printer, data.profile].filter(Boolean).join(" · ");

  async function again() {
    if (!rerun) return;
    const { generator, printerId, profileId } = rerun;
    const { id: generatorId, params: stashed } = generator;
    stashRerun({ generatorId, params: stashed, printerId, profileId, retryOf });
    await goto("/?rerun=1");
  }
</script>

<svelte:head><title>{title} · Conveyor</title></svelte:head>

{#if !job}
  <section class="nf" aria-labelledby="job-title">
    <h1 id="job-title">{title}</h1>
    {#if data.live}
      <p>Watch it live on Make until it finishes.</p>
      <div class="acts">
        <a class="btn primary" href={watch}>Watch it live</a>
      </div>
    {:else}
      <p>It may have been removed, or the link is mistyped.</p>
      <div class="acts">
        <a class="btn primary" href="/history">See your jobs</a>
        <a class="btn" href="/">Go to Make</a>
      </div>
    {/if}
  </section>
{:else}
  <JobHead {title} tone={state ?? ""} pill={state ? PILL[state] : ""} {meta} {when}>
    {#if rerun}
      <button class="btn primary" type="button" on:click={again}>
        {retryOf ? "Retry" : "Print again"}
      </button>
    {/if}
  </JobHead>
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
  }
</style>
