<script lang="ts">
  import {
    BINS,
    beltSummary,
    centre,
    IDLE,
    OFFLINE,
    onRail,
    shortName,
    status,
    type TrackJob,
    today,
    value,
  } from "#lib/track.js";
  import { uid } from "#lib/ui/behaviour.js";
  import { afterNavigate } from "$app/navigation";
  import NeedsYou from "./NeedsYou.svelte";

  export let jobs: TrackJob[];
  export let onAction: (job: TrackJob, action: string) => void;
  export let finishedToday: number | undefined = undefined;
  export let needs: TrackJob[] = [];
  export let offline = false;
  const sheet = uid("sheet");
  let open = false;
  let closing = false;
  let toggle: HTMLButtonElement;

  afterNavigate(() => (open = closing = false));
  const flip = () => {
    closing = open;
    open = !open;
  };
  const settled = (event: AnimationEvent) => {
    if (event.target === event.currentTarget) closing = false;
  };
  $: moving = jobs
    .flatMap((job) => (onRail(job.state) ? [{ job, x: centre(job.state, job.progress ?? 0) }] : []))
    .sort((a, b) => b.x - a.x);
  $: waiting = jobs.filter((job) => job.state === "queued").length;
  function keys(event: KeyboardEvent) {
    const tray =
      event.currentTarget instanceof Element && event.currentTarget.querySelector(".tray");
    if (event.key !== "Escape" || !open || event.defaultPrevented || tray) return;
    flip();
    toggle.focus();
  }
</script>

<section class="m" aria-label="On the belt"><div role="presentation" on:keydown={keys}>
  <div class="chip">
    <div class="tx">
      <b>{offline ? OFFLINE : beltSummary(jobs)}</b>
      <span>{offline ? "Last known jobs" : `${waiting} ${BINS.waiting}`}{#if needs.length}{" · "}<span class="bad">{BINS.needs} {needs.length}</span>{/if}</span>
      <span class="mini" class:stale={offline} aria-hidden="true">{#each moving as { job, x } (job.id)}<i style="left: {x * 100}%"></i>{/each}</span>
    </div>
    <button class="exp" type="button" aria-expanded={open} aria-controls={sheet} aria-label={open ? "Collapse the belt" : "Expand the belt"} bind:this={toggle} on:click={flip}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg></button>
  </div>
  <div class="sheet" class:open class:closing id={sheet} inert={closing} on:animationend={settled}>
    {#each moving as { job } (job.id)}
      <a class="row" href="/jobs/{job.id}"><span class="t">{shortName(job.name)}</span><span class="v">{value(job)}</span><span class="st">{status(job)}</span></a>
    {:else}
      <p class="none">{offline ? OFFLINE : IDLE}</p>
    {/each}
    <div class="bins">
      <a class="done" href="/jobs?day=today">{BINS.finished}<span class="n">{today(finishedToday ?? 0)}</span></a>
      {#if (open || closing) && needs.length}<NeedsYou jobs={needs} {onAction} />{/if}
    </div>
  </div>
</div></section>

<style>
  .m { padding: var(--s1) 0 var(--s2); }
  .chip { display: flex; align-items: center; gap: var(--s2-5); min-height: 56px; padding: var(--s2) var(--s2-5) var(--s2) var(--s3-5); border-radius: var(--r-card); background: var(--belt); color: var(--belt-ink); }
  .tx { flex: 1; min-width: 0; }
  b { display: block; overflow: hidden; font-size: var(--fs-body); text-overflow: ellipsis; white-space: nowrap; }
  .tx > span { display: block; font: 500 var(--fs-label) var(--mono); }
  .bad { color: var(--belt-err); font-weight: 700; }
  .stale { opacity: 0.45; }
  :global([data-theme="dark"]) .chip { box-shadow: 0 0 0 1px var(--faint); }
  .mini { position: relative; height: 8px; margin-top: var(--s1-5); border-radius: var(--r-pill); background: color-mix(in oklch, var(--belt-ink) 18%, transparent); }
  .mini i { position: absolute; top: -3px; width: 14px; height: 14px; border: 2px solid var(--belt-ink); border-radius: 50%; background: var(--live); transform: translateX(-50%); }
  .exp { display: grid; flex: none; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: color-mix(in oklch, var(--belt-ink) 16%, transparent); color: var(--belt-ink); cursor: pointer; }
  .chip :focus-visible { outline-color: var(--belt-ink); }
  .exp svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.25; stroke-linecap: round; stroke-linejoin: round; }
  .sheet { display: none; gap: var(--s1-5); max-height: 60vh; margin: var(--s2) calc(-1 * var(--s1-5)) 0; padding: var(--s1-5); overflow-y: auto; }
  .sheet.open {
    display: grid;
    transition: opacity var(--t-move) ease-out, translate var(--t-move) var(--ease-move);
  }
  @starting-style { .sheet.open { opacity: 0; translate: 0 calc(-1 * var(--s2)); } }
  .sheet.closing { display: grid; animation: shut var(--t-fast) ease-in forwards; }
  @keyframes shut { to { opacity: 0; translate: 0 calc(-1 * var(--s2)); } }
  .row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: var(--s0) var(--s2); min-height: 48px; padding: var(--s1-5) var(--s3-5); border: 1px solid var(--line-2); border-radius: var(--r-chip); background: var(--paper); color: var(--ink); text-decoration: none; }
  .t { overflow: hidden; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
  .v { font: 500 var(--fs-mono) var(--mono); color: var(--live); }
  .st { grid-column: 1 / -1; font: 500 var(--fs-mono) var(--mono); color: var(--muted); }
  .none { margin: 0; padding: var(--s2) 0; color: var(--muted); }
  .bins { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s1-5); }
  .bins :global(.wrap) { display: contents; }
  .bins :global(.needs) { min-height: 44px; }
  .bins :global(.tray) { position: static; grid-column: 1 / -1; width: auto; box-shadow: none; }
  .done { display: flex; align-items: center; gap: var(--s2); min-height: 44px; padding: 0 var(--s2-5); border: 1.5px solid var(--ok); border-radius: var(--r-inner); background: var(--paper); color: var(--ok); font-size: var(--fs-chip); font-weight: 700; text-decoration: none; }
  .n { margin-left: auto; font: 500 var(--fs-mono) var(--mono); color: var(--muted); }
</style>
