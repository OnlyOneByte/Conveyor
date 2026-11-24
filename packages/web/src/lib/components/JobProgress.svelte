<script lang="ts">
  import type { JobView } from "@conveyor/shared";
  import { measured, percent, printLine, STEPS } from "#lib/job-live.js";

  export let view: JobView;

  const clock = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { timeStyle: "short" }).replace(/\s/g, "\u00a0");

  $: now = STEPS.findIndex(([step]) => step === view.state);
  $: pct = percent(view);
  $: detail = view.state === "printing" ? printLine(view.print, view.at, clock) : "";
</script>

<section class="live">
  <h2>Progress</h2>
  <ol class="steps">
    {#each STEPS as [state, label], i (state)}
      <li class:past={i < now} class:now={i === now} aria-current={i === now ? "step" : undefined}>
        {label}
      </li>
    {/each}
  </ol>
  {#if measured(view)}
    <p class="big"><b>{pct}%</b>{#if detail}<span>{detail}</span>{/if}</p>
    <div
      class="bar" role="progressbar" aria-label="{STEPS[now]?.[1] ?? 'Job'} progress"
      aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
    ><i style:width="{pct}%"></i></div>
  {/if}
</section>

<style>
  .live { display: flex; flex-direction: column; gap: var(--s5); }
  .big { display: flex; align-items: baseline; gap: var(--s3); flex-wrap: wrap; margin: 0; }
  .big b { font-size: 34px; line-height: 1; letter-spacing: -0.03em; }
  .big span { color: var(--muted); }
  .steps {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s2);
    list-style: none; padding: 0; margin: 0;
  }
  .steps li {
    display: flex; flex-direction: column; gap: 6px; font-weight: 600; color: var(--muted);
  }
  .steps li::before { content: ""; height: 6px; border-radius: 3px; background: var(--field-line); }
  .steps li.past::before { background: var(--ok); }
  .steps li.past::after { content: "✓ done"; font: 500 12px var(--mono); color: var(--ok); }
  .steps li.now { color: var(--ink); }
  .steps li.now::before { background: var(--live); }
  .steps li.now::after { content: "now"; font: 500 12px var(--mono); color: var(--live); }
  .bar {
    height: 14px; border-radius: 7px; overflow: hidden;
    background: var(--sunk); border: 1px solid var(--field-line);
  }
  .bar i { display: block; height: 100%; background: var(--live); transition: width 0.3s; }
</style>
