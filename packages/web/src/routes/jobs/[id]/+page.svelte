<script lang="ts">
  import { onDestroy } from "svelte";
  import { afterNavigate, goto, invalidateAll, replaceState } from "$app/navigation";
  import type { JobView } from "@conveyor/shared";
  import { titled } from "#lib/belt.js";
  import CancelJob from "#lib/components/CancelJob.svelte";
  import JobHead from "#lib/components/JobHead.svelte";
  import JobProgress from "#lib/components/JobProgress.svelte";
  import JobReceipt from "#lib/components/JobReceipt.svelte";
  import Viewport from "#lib/components/Viewport.svelte";
  import { failureText } from "#lib/job-failure.js";
  import { isRecord, jobName, settingRows } from "#lib/job-settings.js";
  import { firstEnd, followJob, pillText, SETTLED } from "#lib/job-live.js";
  import { rerunRequest, stashRerun } from "#lib/rerun.js";
  import type { PageData } from "./$types";

  export let data: PageData;

  const WHEN = { done: "Finished", failed: "Stopped", canceled: "Canceled" } as const;
  const DATE = { dateStyle: "medium", timeStyle: "short" } as const;

  let latest: JobView | null = null;
  let stop = () => {};
  $: job = data.job;
  $: live = data.view && { ...data.view, ...latest };
  $: {
    stop();
    latest = null;
    stop = data.view ? followJob(data.view.jobId, (v) => (latest = v), settle) : () => {};
  }
  onDestroy(() => stop());
  afterNavigate(({ to }) => {
    if (to && location.pathname !== to.url.pathname) replaceState(to.url, {});
  });
  $: gen = data.generator;
  $: params = job?.request.generator.params ?? live?.generator?.params;
  $: schema = gen?.paramSchema ?? null;
  $: rows = settingRows(params, schema, gen?.ui ?? null);
  $: generatorId = job?.request.generator.id ?? live?.generator?.id;
  $: fallback = generatorId ? titled(generatorId) : "";
  $: name = fallback ? jobName(gen?.name ?? fallback, params, schema, gen?.ui ?? null) : "";
  $: title = name || (live ? "Job on the belt" : "We can't find that job");
  $: state = job?.state === "done" || job?.state === "failed" || job?.state === "canceled"
    ? job.state
    : null;
  $: failure = job?.error ? failureText(job.error.stage, job.error.reason) : null;
  $: retryOf = job?.state === "failed" && job.request.generator.id !== "passthrough"
    && job.request.printerId && job.request.profileId ? job.id : undefined;
  $: rerun = job ? (rerunRequest(job) ?? (retryOf ? job.request : null)) : null;
  $: started = live?.timings?.[0]?.enteredAt ?? live?.createdAt;
  $: at = job ? job.updatedAt : live?.state === "queued" ? live.createdAt : started;
  $: since = state ? WHEN[state] : live?.state === "queued" ? "Added" : "Started";
  $: stamp = at === undefined ? "" : new Date(at).toLocaleString([], DATE);
  $: when = stamp && `${since} ${stamp}`;
  $: tone = state ?? (live?.state === "queued" ? "queued" : "live");
  $: pill = pillText(job ?? live ?? { state: "queued" });
  $: meta = [data.printer, data.profile].filter(Boolean).join(" · ");

  async function again() {
    if (!rerun) return;
    const { generator, printerId, profileId } = rerun;
    const { id: generatorId, params: stashed } = generator;
    stashRerun({ generatorId, params: stashed, printerId, profileId, retryOf });
    await goto("/?rerun=1");
  }

  function settle() {
    const id = data.view && !SETTLED.includes(data.view.state) ? data.view.jobId : null;
    if (id && firstEnd(id)) setTimeout(invalidateAll, 300);
  }
</script>

<svelte:head><title>{title} · Conveyor</title></svelte:head>

{#if !job && !live}
  <section class="nf" aria-labelledby="job-title">
    <h1 id="job-title">{title}</h1>
    <p>It may have been removed, or the link is mistyped.</p>
    <div class="acts">
      <a class="btn primary" href="/history">See your jobs</a>
      <a class="btn" href="/">Go to Make</a>
    </div>
  </section>
{:else}
  <JobHead {title} {tone} {pill} {meta} {when}>
    {#if rerun}
      <button class="btn primary" type="button" on:click={again}>
        {retryOf ? "Retry" : "Print again"}
      </button>
    {:else if live}
      {#key live.jobId}<CancelJob id={live.jobId} printing={live.state === "printing"} />{/key}
    {/if}
  </JobHead>
  {#if failure}
    <div class="why" role="note"><strong>{failure.title}</strong><p>{failure.detail}</p></div>
  {/if}
  <div class="grid">
    <div class="mat">
      {#if gen?.preview?.module === "gridfinity"}
        <Viewport params={isRecord(params) ? params : {}} />
      {:else}
        <span class="tag">{title}</span>
      {/if}
    </div>
    <JobReceipt job={job ?? { id: live?.jobId ?? "", state: live?.state ?? "queued" }} {rows}>
      {#if live}<JobProgress view={live} place={data.place} printer={data.printer} />{/if}
    </JobReceipt>
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
