<script lang="ts">
  import { centre, type Group, MIN_CHIP_PX, merge, onRail, type RailState, SPANS, STAGE_LABELS, type TrackJob } from "#lib/track.js";
  import { type Departure, departures, hopDistance } from "#lib/motion.js";
  import { prefersReducedMotion } from "#lib/preferences.js";
  import { step } from "#lib/shortcuts.js";
  import Chip from "./Chip.svelte";
  import NeedsYou from "./NeedsYou.svelte";

  export let jobs: TrackJob[];
  export let ended: TrackJob[] = [];
  export let idle = "Nothing on the rail";
  export let onAction: (job: TrackJob, action: string) => void = () => {};
  export let finishedToday: number | undefined = undefined;
  export let needs: TrackJob[] | undefined = undefined;
  let rail: HTMLDivElement;
  let active = 0;
  let railPx = 0;
  let groups: Group[] = [];
  const widths: Record<string, number> = {};
  const groupWidths: Record<string, number> = {};
  const lefts = new Map<string, number>();
  let leaving: Departure[] = [];
  let hidden = document.hidden;

  $: moving = jobs.filter((j) => onRail(j.state));
  $: waiting = jobs.filter((j) => j.state === "queued").length;
  $: finished = finishedToday ?? jobs.filter((j) => j.state === "done").length;
  $: failed = jobs.filter((j) => j.state === "failed").length;
  $: byId = new Map(jobs.map((j) => [j.id, j]));
  const RAIL: RailState[] = ["generating", "slicing", "transferring", "printing"];
  $: stages = RAIL.map((state) => ({ state, start: SPANS[state][0], on: moving.some((j) => j.state === state) }));
  $: layout(moving, railPx, widths, groupWidths);

  function layout(list: TrackJob[], px: number, sizes: Record<string, number>, grouped: Record<string, number>) {
    const placed = list.flatMap((j) => (onRail(j.state) ? [{ id: j.id, x: centre(j.state, j.progress ?? 0) * px, width: sizes[j.id] || MIN_CHIP_PX }] : []));
    groups = merge(placed, px, groups, (m) => grouped[m.map((p) => p.id).join(" ")] || Math.max(...m.map((p) => p.width)));
    for (const g of groups) for (const id of g.ids) lefts.set(id, Math.round(g.x - g.width / 2));
  }
  $: if (ended.length) leave(ended);
  function leave(list: TrackJob[]) {
    const now = departures(list, lefts);
    if (now.length && !prefersReducedMotion()) leaving = [...leaving, ...now];
  }
  const landed = (job: TrackJob) => (leaving = leaving.filter((d) => d.job !== job));
  const members = (g: Group) => g.ids.flatMap((id) => byId.get(id) ?? []);
  $: if (active >= groups.length) active = 0;

  function walk(event: KeyboardEvent) {
    const by = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!by) return;
    const stops = [...rail.querySelectorAll<HTMLElement>("[data-stop]")];
    const at = stops.findIndex((el) => el === document.activeElement);
    if (at < 0) return;
    const to = stops[step(at, by, stops.length)];
    if (to?.dataset.stop) active = Number(to.dataset.stop);
    to?.focus();
    event.preventDefault();
  }
</script>

<svelte:document on:visibilitychange={() => (hidden = document.hidden)} />
<section class="belt" class:paused={hidden} aria-label="On the belt">
  <div class="queue">
    <span class="label">Queue</span>
    <span class="slot q">{waiting ? "Waiting" : "Empty"}{#if waiting}<span class="n">{waiting}</span>{/if}</span>
  </div>
  <div class="lane" role="group" aria-label="Rail, {moving.length} moving">
    {#each stages as stage (stage.state)}
      <i class="tick" style="left: {stage.start * 100}%"></i>
      <span class="stage" class:on={stage.on} style="left: calc({stage.start * 100}% + 8px)">{STAGE_LABELS[stage.state]}</span>
    {/each}
    <div class="rail"><i class="treads" class:run={moving.length > 0}></i></div>
    <div class="chips" role="presentation" bind:this={rail} bind:clientWidth={railPx} on:keydown={walk}>
      {#each groups as group, i (group.ids.join(" "))}
        <Chip jobs={members(group)} left={Math.round(group.x - group.width / 2)} index={i} tabindex={i === active ? 0 : -1} end={group.x > railPx / 2} {onAction} />
      {/each}
      {#each leaving as { job, left } (job.id)}
        <div class="gone" data-end={job.state} style="--left: {left}px; --dx: {hopDistance(left, railPx)}px" aria-hidden="true" inert on:animationend={(event) => event.target === event.currentTarget && landed(job)}><Chip jobs={[job]} left={0} /></div>
      {/each}
    </div>
    {#if moving.length === 0 && waiting === 0}<span class="label idle">{idle}</span>{/if}
    <div class="measure" aria-hidden="true" inert>
      {#each moving as job (job.id)}<Chip jobs={[job]} bind:width={widths[job.id]} />{/each}
      {#each groups.filter((g) => g.ids.length > 1) as group (group.ids.join(" "))}<Chip jobs={members(group)} bind:width={groupWidths[group.ids.join(" ")]} />{/each}
    </div>
  </div>
  <div class="bins">
    <a class="slot done" href="/history">Finished<span class="n">{finished} today</span></a>
    {#if needs}{#if needs.length}<NeedsYou jobs={needs} {onAction} />{/if}{:else if failed}<span class="slot needs">Needs you<span class="n">{failed}</span></span>{/if}
  </div>
</section>

<style>
  .belt { display: grid; grid-template-columns: 150px minmax(0, 1fr) 170px; gap: var(--s4); align-items: end; min-height: 110px; }
  .label { font: 700 var(--fs-label) / 1 var(--display); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .queue { display: grid; gap: var(--s1); }
  .slot { display: flex; align-items: center; gap: var(--s2); min-height: 38px; padding: 0 10px; border: 1.5px dashed var(--muted); border-radius: 12px; background: var(--sunk); font-size: 13px; font-weight: 700; white-space: nowrap; }
  .n { margin-left: auto; font: 500 12px var(--mono); color: var(--muted); }
  .bins { display: grid; gap: 6px; }
  .done { border-style: solid; border-color: var(--ok); background: var(--paper); color: var(--ok); text-decoration: none; }
  .needs { border-style: solid; border-color: var(--err); background: var(--paper); color: var(--err); }
  .lane { position: relative; height: 110px; }
  .tick { position: absolute; bottom: 8px; width: 2px; height: 30px; background: var(--muted); }
  .stage { position: absolute; bottom: 36px; font: 500 10.5px var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .stage.on { color: var(--ink); }
  .stage.on::before { content: "● " / ""; color: var(--live); }
  .rail { position: absolute; inset: auto 0 8px; height: 22px; overflow: hidden; border-radius: 11px; background: var(--belt); }
  .treads { position: absolute; inset: 0 0 0 -26px; background: repeating-linear-gradient(90deg, var(--tread) 0 3px, transparent 3px 26px); }
  .treads.run { animation: tread 1.3s linear infinite; will-change: transform; }
  @keyframes tread { to { transform: translateX(26px); } }
  .gone { position: absolute; inset: 0 auto auto 0; transform: translateX(var(--left)); animation: hop var(--t-hop) var(--ease-move) forwards; pointer-events: none; }
  .gone[data-end="failed"] { animation-name: drop; }
  .gone[data-end="canceled"] { animation: fade var(--t-fast) linear forwards; }
  @keyframes hop { 60% { opacity: 1; } to { transform: translateX(calc(var(--left) + var(--dx))); opacity: 0; } }
  @keyframes drop { 60% { opacity: 1; } to { transform: translate(calc(var(--left) + var(--dx)), 44px); opacity: 0; } }
  @keyframes fade { to { opacity: 0; } }
  .paused .treads, .paused .gone { animation-play-state: paused; }
  :global([data-theme="dark"]) .rail { box-shadow: 0 0 0 1px var(--faint); }
  .chips { position: absolute; inset: 2px 0 auto; height: 52px; }
  .idle { position: absolute; top: 40%; left: 50%; transform: translateX(-50%); white-space: nowrap; }
  .measure { position: absolute; visibility: hidden; pointer-events: none; }
  @media (max-width: 759px) { .belt { grid-template-columns: 1fr 1fr; } .lane { grid-column: 1 / -1; grid-row: 1; } .stage { display: none; } }
</style>
