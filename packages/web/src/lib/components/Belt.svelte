<script lang="ts">
  import { tick } from "svelte";
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import { centre, collapsedBelt, onRail, SPANS, type TrackJob } from "#lib/track.js";
  import MobileBelt from "./MobileBelt.svelte";
  import Track from "./Track.svelte";

  export let jobs: TrackJob[];
  export let ended: TrackJob[] = [];
  export let onAction: (job: TrackJob, action: string) => void;
  export let finishedToday: number | undefined = undefined;
  export let needs: TrackJob[] = [];
  let scrollY = 0;
  let opened = false;
  let toggle: HTMLButtonElement | undefined;
  const TICKS = [...Object.values(SPANS).slice(1).map(([start]) => start), 1];
  let collapsed = false;
  const next = (path: string, y: number, open: boolean) => collapsedBelt(path, y, open, collapsed);

  afterNavigate(() => (opened = false));
  $: collapsed = next(page.url.pathname, scrollY, opened);
  $: dots = jobs.flatMap((job) => (onRail(job.state) ? [{ id: job.id, x: centre(job.state, job.progress ?? 0) }] : []));
  $: waiting = jobs.filter((job) => job.state === "queued").length;

  async function open(to: boolean) {
    opened = to;
    await tick();
    toggle?.focus();
  }
  function keys(event: KeyboardEvent) {
    const tray = event.currentTarget instanceof Element && event.currentTarget.querySelector(".tray");
    if (event.key === "Escape" && opened && !event.defaultPrevented && !tray) void open(false);
  }
</script>

<svelte:window bind:scrollY />
<div class="mobile"><MobileBelt {jobs} {onAction} {finishedToday} {needs} /></div>
<div class="desktop">
{#if collapsed}
  <div class="bar" role="group" aria-label="Belt">
    <b>Belt</b>
    <span class="seg">{waiting} waiting</span>
    <span class="mini" aria-hidden="true">{#each TICKS as x (x)}<u style="left: {x * 100}%"></u>{/each}{#each dots as dot (dot.id)}<i style="left: {dot.x * 100}%"></i>{/each}</span>
    <span class="sr">{dots.length} on the rail</span>
    {#if finishedToday}<a class="seg good" href="/jobs?day=today">{finishedToday} finished</a>{/if}
    {#if needs.length}<a class="seg bad" href="/jobs">{needs.length} needs you</a>{/if}
    <button class="exp" type="button" aria-expanded="false" aria-label="Expand the belt" bind:this={toggle} on:click={() => open(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button>
  </div>
{:else}
  <div class="full" class:opened role="presentation" on:keydown={keys}>
    {#if opened}<button class="exp shut" type="button" aria-expanded="true" aria-label="Collapse the belt" bind:this={toggle} on:click={() => open(false)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg></button>{/if}
    <Track {jobs} {ended} {onAction} {finishedToday} {needs} />
  </div>
{/if}
</div>

<style>
  .bar { display: flex; align-items: center; gap: var(--s2); height: 40px; margin: 6px 0; padding: 0 6px 0 14px; border-radius: 20px; background: var(--belt); color: var(--belt-ink); }
  b { font-weight: 750; font-size: 13.5px; }
  .seg { display: flex; align-items: center; height: 28px; padding: 0 10px; border-radius: 14px; background: color-mix(in oklch, var(--belt-ink) 10%, transparent); color: var(--belt-ink); font: 500 12px var(--mono); white-space: nowrap; text-decoration: none; }
  .good { background: color-mix(in oklch, var(--ok) 30%, transparent); }
  .bad { background: color-mix(in oklch, var(--err) 40%, transparent); }
  .mini { position: relative; flex: 1; height: 8px; margin: 0 var(--s2); border-radius: 4px; background: color-mix(in oklch, var(--belt-ink) 18%, transparent); }
  .mini u { position: absolute; top: -2px; bottom: -2px; width: 2px; background: color-mix(in oklch, var(--belt-ink) 70%, transparent); }
  .mini i { position: absolute; top: -3px; width: 14px; height: 14px; border: 2px solid var(--belt-ink); border-radius: 50%; background: var(--live); transform: translateX(-50%); }
  .exp { display: grid; place-items: center; width: 30px; height: 30px; min-height: 30px; padding: 0; border: 0; border-radius: 50%; background: color-mix(in oklch, var(--belt-ink) 16%, transparent); color: var(--belt-ink); cursor: pointer; }
  .bar :focus-visible { outline-color: var(--belt-ink); }
  .mini u:last-of-type { transform: translateX(-100%); }
  .exp svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.25; stroke-linecap: round; stroke-linejoin: round; }
  .full { position: relative; }
  .full.opened { padding-right: 38px; }
  .shut { position: absolute; top: 0; right: 0; z-index: 6; background: var(--belt); }
  .mobile { display: none; }
  @media (max-width: 759px) { .mobile { display: block; } .desktop { display: none; } }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
