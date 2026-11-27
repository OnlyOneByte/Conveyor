<script lang="ts">
  import type { JobView } from "@conveyor/shared";
  import { onDestroy } from "svelte";
  import { titled } from "#lib/belt.js";
  import FailureNote from "#lib/components/FailureNote.svelte";
  import HoldNote from "#lib/components/HoldNote.svelte";
  import JobActions from "#lib/components/JobActions.svelte";
  import JobHead from "#lib/components/JobHead.svelte";
  import JobProgress from "#lib/components/JobProgress.svelte";
  import JobReceipt from "#lib/components/JobReceipt.svelte";
  import Viewport from "#lib/components/Viewport.svelte";
  import { failureText } from "#lib/job-failure.js";
  import { followJob, pillText, SETTLED } from "#lib/job-live.js";
  import { isRecord, jobName, settingRows } from "#lib/job-settings.js";
  import { rerunRequest, stashRerun } from "#lib/rerun.js";
  import { goto, invalidateAll } from "$app/navigation";
  import type { JobPageData } from "./+page.js";

  export let data: JobPageData;

  const WHEN = { done: "Finished", failed: "Stopped", canceled: "Canceled" } as const;
  const DATE = { dateStyle: "medium", timeStyle: "short" } as const;

  let latest: JobView | null = null;
  let stop = () => {};
  const settle = () => void setTimeout(invalidateAll, 300);
  $: job = data.job;
  $: live = data.view && { ...data.view, ...latest };
  $: {
    stop();
    latest = null;
    const watching = data.view && !SETTLED.includes(data.view.state) ? data.view.jobId : null;
    stop = watching ? followJob(watching, (v) => (latest = v), settle) : () => {};
  }
  onDestroy(() => stop());
  $: gen = data.generator;
  $: params = job?.request.generator.params ?? live?.generator?.params;
  $: schema = gen?.paramSchema ?? null;
  $: rows = settingRows(params, schema, gen?.ui ?? null);
  $: generatorId = job?.request.generator.id ?? live?.generator?.id;
  $: fallback = generatorId ? titled(generatorId) : "";
  let name: string;
  $: name = fallback ? jobName(gen?.name ?? fallback, params, schema, gen?.ui ?? null) : "";
  $: title = name || (live ? "Job on the belt" : "We can't find that job");
  $: state =
    job?.state === "done" || job?.state === "failed" || job?.state === "canceled"
      ? job.state
      : null;
  let stopped = -1;
  $: stage = stopped === 3 ? "printing" : (job?.error?.stage ?? "");
  $: failure = job?.error ? failureText(stage, job.error.reason) : null;
  $: said = failure && cardFirst ? `${failure.title}. ${failure.detail}` : "";
  $: retryOf =
    job?.state === "failed" &&
    job.request.generator.id !== "passthrough" &&
    job.request.printerId &&
    job.request.profileId
      ? job.id
      : undefined;
  $: rerun = job ? (rerunRequest(job) ?? (retryOf ? job.request : null)) : null;
  $: started = live?.timings?.[0]?.enteredAt ?? live?.createdAt;
  $: at = job ? job.updatedAt : live?.state === "queued" ? live.createdAt : started;
  $: since = state ? WHEN[state] : live?.state === "queued" ? "Added" : "Started";
  $: stamp = at === undefined ? "" : new Date(at).toLocaleString([], DATE);
  $: when = stamp && `${since} ${stamp}`;
  $: tone = state ?? (live?.state === "queued" ? "queued" : "live");
  $: pill = pillText(job ?? live ?? { state: "queued" });
  $: meta = [data.printer, data.profile].filter(Boolean).join(" · ");
  let seenLive = "";
  $: if (live && !job) seenLive = live.jobId;
  $: cardFirst = seenLive !== "" && seenLive === (job?.id ?? live?.jobId);

  async function again() {
    if (!rerun) return;
    const { generator, printerId, profileId } = rerun;
    const { id: generatorId, params: stashed } = generator;
    stashRerun({ generatorId, params: stashed, printerId, profileId, retryOf });
    await goto("/?rerun=1");
  }
</script>

<svelte:head><title>{title} · Conveyor</title></svelte:head>

{#if !job && !live}
  <section class="nf" aria-labelledby="job-title">
    <h1 id="job-title">{title}</h1>
    <p>It may have been removed, or the link is mistyped.</p>
    <div class="acts">
      <a class="btn primary" href="/jobs">See your jobs</a>
      <a class="btn" href="/">Go to Make</a>
    </div>
  </section>
{:else}
  <JobHead {title} {tone} {pill} {meta} {when} stretch={!live || Boolean(rerun)}>
    <p slot="status" class="sr" role="status">{said}</p>
    <JobActions rerun={Boolean(rerun)} retry={Boolean(retryOf)} held={data.held} {live} {again} />
  </JobHead>
  {#if failure && !cardFirst}<FailureNote {failure} />{/if}
  {#if rerun && data.held && !cardFirst}<HoldNote />{/if}
  {#snippet model()}
    <div class="mat">
      {#if gen?.preview?.module === "gridfinity"}<Viewport params={isRecord(params) ? params : {}} />
      {:else}<span class="tag">{title}</span>{/if}
    </div>
  {/snippet}
  <div class="grid" class:first={cardFirst}>
    {#if !cardFirst}{@render model()}{/if}
    <JobReceipt job={job ?? { id: live?.jobId ?? "", state: live?.state ?? "queued" }} {rows}>
      {#if live || (cardFirst && job)}
        <JobProgress view={live} settled={cardFirst ? job : null} printer={data.printer}
          bind:stopped note={cardFirst ? failure : null} />{/if}
    </JobReceipt>
    {#if cardFirst}{@render model()}{/if}
  </div>
{/if}

<style>
  h1 { margin: 0; font-size: var(--fs-title); line-height: 1.05; letter-spacing: -0.04em; }
  p { margin: 0; }
  .btn {
    min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body);
    text-decoration: none; border-color: var(--field-line);
  }
  .btn.primary { border-color: var(--accent); }
  .acts { display: flex; gap: var(--s2); flex-wrap: wrap; }
  .grid {
    display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    gap: var(--s5); align-items: start;
  }
  .grid.first .mat { grid-column: 1; grid-row: 1; }
  .mat {
    position: relative; aspect-ratio: 4 / 3; display: grid; place-items: center;
    overflow: hidden; border-radius: var(--r-panel); background: var(--mat);
  }
  .tag {
    padding: var(--s1) var(--s2-5); border-radius: var(--r-pill); background: var(--paper); font: 500 var(--fs-mono) var(--mono);
  }
  .nf { max-width: 520px; display: flex; flex-direction: column; gap: var(--s4); padding: 10vh 0; }
  @media (max-width: 759px) {
    .grid { grid-template-columns: 1fr; }
    .grid.first .mat { grid-column: auto; grid-row: auto; }
  }
</style>
