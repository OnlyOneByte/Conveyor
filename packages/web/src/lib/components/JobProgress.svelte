<script lang="ts">
  import type { JobView } from "@conveyor/shared";
  import { activeJobs } from "#lib/active-jobs.js";
  import type { JobHistoryEntry } from "#lib/api.js";
  import {
    measured,
    ordinal,
    percent,
    placeInLine,
    printLine,
    SETTLED,
    STEPS,
  } from "#lib/job-live.js";
  import { duration } from "#lib/job-settings.js";

  export let view: JobView | null = null;
  export let settled: JobHistoryEntry | null = null;
  export let printer: string;
  export let stopped = -1;
  export let note: { title: string; detail: string } | null = null;

  const OUTCOME: Record<string, string> = {
    done: "Printed",
    failed: "Failed",
    canceled: "Canceled",
  };
  const STOP: Record<string, number> = { generator: 0, slicer: 1 };
  const clock = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { timeStyle: "short" }).replace(/\s/g, "\u00a0");

  let height = 0;
  let kept = 0;
  let reached = -1;
  $: outcome = settled?.state ?? (view && SETTLED.includes(view.state) ? view.state : null);
  $: if (!outcome) kept = height;
  $: live = STEPS.findIndex(([step]) => step === view?.state);
  $: if (!outcome && live > reached) reached = live;
  $: endedAt = settled?.error?.stage ?? settled?.stage ?? "";
  $: ranTo = endedAt === "transport" ? Math.max(reached, 2) : reached;
  $: stopped = outcome && outcome !== "done" ? (STOP[endedAt] ?? ranTo) : -1;
  $: took = settled?.timings?.reduce((sum, t) => sum + (t.durationMs ?? 0), 0) ?? 0;
  $: now = outcome ? (outcome === "done" ? STEPS.length : stopped) : live;
  $: pct = view ? percent(view) : 0;
  $: detail = view?.state === "printing" ? printLine(view.print, view.at, clock) : "";

  $: place =
    view?.state === "queued" && $activeJobs ? placeInLine(view.jobId, $activeJobs.jobs) : null;
</script>

<section
  class="live" bind:clientHeight={height} style:min-height={outcome && kept ? `${kept}px` : null}
>
  <h2>Progress</h2>
  {#if view?.state === "queued"}
    {#if place}
      <p class="big"><b>{ordinal(place)}</b><span>in line for the {printer}</span></p>
    {:else}
      <p class="big"><b>Waiting</b><span>for the {printer}</span></p>
    {/if}
  {/if}
  <ol class="steps">
    {#each STEPS as [state, label], i (state)}
      <li
        class:past={i < now && i !== stopped} class:now={!outcome && i === now}
        class:stop={i === stopped} aria-current={!outcome && i === now ? "step" : undefined}
      >
        {label}
      </li>
    {/each}
  </ol>
  {#if outcome}
    <p class="big">
      <b>{OUTCOME[outcome] ?? "Finished"}</b>
      {#if note}<span>{note.title}</span>{:else if took}<span>Took {duration(took)}</span>{/if}
      {#if note}<span class="why">{note.detail}</span>{/if}
    </p>
    {#if outcome === "done"}
      <div class="bar done" role="progressbar" aria-label="Job progress" aria-valuenow={100}
        aria-valuemin={0} aria-valuemax={100}><i></i></div>
    {/if}
  {:else if view && measured(view)}
    <p class="big"><b>{pct}%</b>{#if detail}<span>{detail}</span>{/if}</p>
    <div
      class="bar" role="progressbar" aria-label="{STEPS[now]?.[1] ?? 'Job'} progress"
      aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
    ><i style:transform="scaleX({pct / 100})"></i></div>
  {/if}
</section>

<style>
  .live { display: flex; flex-direction: column; gap: var(--s5); }
  .big { display: flex; align-items: baseline; gap: var(--s3); flex-wrap: wrap; margin: 0; }
  .big b { font-size: var(--fs-title); line-height: 1; letter-spacing: -0.03em; }
  .big span { color: var(--muted); }
  .big:has(.why) { row-gap: var(--s1); }
  .big .why {
    flex-basis: 100%; padding-left: var(--s3); border-left: 3px solid var(--err);
    color: var(--ink); font-size: var(--fs-chip); line-height: 1.35;
  }
  .steps {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s2);
    list-style: none; padding: 0; margin: 0;
  }
  .steps li {
    display: flex; flex-direction: column; gap: var(--s1-5); font-weight: 600; color: var(--muted);
  }
  .steps li::before { content: ""; height: 6px; border-radius: var(--r-pill); background: var(--field-line); }
  .steps li.past::before { background: var(--ok); }
  .steps li.past::after { content: "✓ done"; font: 500 var(--fs-mono) var(--mono); color: var(--ok); }
  .steps li.now { color: var(--ink); }
  .steps li.now::before { background: var(--live); }
  .steps li.now::after { content: "now"; font: 500 var(--fs-mono) var(--mono); color: var(--live); }
  .steps li.stop { color: var(--ink); }
  .steps li.stop::before { background: var(--err); }
  .steps li.stop::after { content: "stopped"; font: 500 var(--fs-mono) var(--mono); color: var(--err); }
  .bar.done i { transform: scaleX(1); background: var(--ok); }
  .bar {
    height: 14px; border-radius: var(--r-pill); overflow: hidden;
    background: var(--sunk); border: 1px solid var(--field-line);
  }
  .bar i { display: block; height: 100%; background: var(--live); transform-origin: left; transition: transform var(--t-move) var(--ease-move); }
</style>
