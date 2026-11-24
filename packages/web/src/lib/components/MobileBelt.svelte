<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { beltSummary, centre, onRail, shortName, status, type TrackJob, value } from "#lib/track.js";
  import { uid } from "#lib/ui/behaviour.js";
  import NeedsYou from "./NeedsYou.svelte";

  export let jobs: TrackJob[];
  export let onAction: (job: TrackJob, action: string) => void;
  export let finishedToday: number | undefined = undefined;
  export let needs: TrackJob[] = [];
  const sheet = uid("sheet");
  let open = false;
  let toggle: HTMLButtonElement;

  afterNavigate(() => (open = false));
  $: moving = jobs.flatMap((job) => (onRail(job.state) ? [{ job, x: centre(job.state, job.progress ?? 0) }] : [])).sort((a, b) => b.x - a.x);
  $: waiting = jobs.filter((job) => job.state === "queued").length;
  function keys(event: KeyboardEvent) {
    const tray = event.currentTarget instanceof Element && event.currentTarget.querySelector(".tray");
    if (event.key !== "Escape" || !open || event.defaultPrevented || tray) return;
    open = false;
    toggle.focus();
  }
</script>

<section class="m" aria-label="On the belt"><div role="presentation" on:keydown={keys}>
  <div class="chip">
    <div class="tx">
      <b>{beltSummary(jobs)}</b>
      <span>{waiting} waiting{needs.length ? ` · ${needs.length} needs you` : ""}</span>
      <span class="mini" aria-hidden="true">{#each moving as { job, x } (job.id)}<i style="left: {x * 100}%"></i>{/each}</span>
    </div>
    <button class="exp" type="button" aria-expanded={open} aria-controls={sheet} aria-label={open ? "Collapse the belt" : "Expand the belt"} bind:this={toggle} on:click={() => (open = !open)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg></button>
  </div>
  {#if open}
    <div class="sheet" id={sheet}>
      {#each moving as { job } (job.id)}
        <a class="row" href="/jobs/{job.id}"><span class="t">{shortName(job.name)}</span><span class="v">{value(job)}</span><span class="st">{status(job)}</span></a>
      {:else}
        <p class="none">Nothing is moving right now.</p>
      {/each}
      <div class="bins">
        <a class="done" href="/history">Finished<span class="n">{finishedToday ?? 0} today</span></a>
        {#if needs.length}<NeedsYou jobs={needs} {onAction} />{/if}
      </div>
    </div>
  {/if}
</div></section>

<style>
  .m { padding: var(--s1) 0 var(--s2); }
  .chip { display: flex; align-items: center; gap: 10px; min-height: 56px; padding: var(--s2) 10px var(--s2) 14px; border-radius: 18px; background: var(--belt); color: var(--belt-ink); }
  .tx { flex: 1; min-width: 0; }
  b { display: block; overflow: hidden; font-size: 14.5px; text-overflow: ellipsis; white-space: nowrap; }
  .tx > span { display: block; font: 500 11.5px var(--mono); }
  .mini { position: relative; height: 8px; margin-top: 6px; border-radius: 4px; background: color-mix(in oklch, var(--belt-ink) 18%, transparent); }
  .mini i { position: absolute; top: -3px; width: 14px; height: 14px; border: 2px solid var(--belt-ink); border-radius: 50%; background: var(--live); transform: translateX(-50%); }
  .exp { display: grid; flex: none; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: color-mix(in oklch, var(--belt-ink) 16%, transparent); color: var(--belt-ink); cursor: pointer; }
  .exp svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.25; stroke-linecap: round; stroke-linejoin: round; }
  .sheet { display: grid; gap: 6px; max-height: 60vh; margin-top: var(--s2); overflow-y: auto; }
  .row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px var(--s2); min-height: 48px; padding: 6px 14px; border: 1px solid var(--line-2); border-radius: var(--r-chip); background: var(--paper); color: var(--ink); text-decoration: none; }
  .t { overflow: hidden; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
  .v { font: 500 12px var(--mono); color: var(--live); }
  .st { grid-column: 1 / -1; font: 500 12px var(--mono); color: var(--muted); }
  .none { margin: 0; padding: var(--s2) 0; color: var(--muted); }
  .bins { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .done { display: flex; align-items: center; gap: var(--s2); min-height: 44px; padding: 0 10px; border: 1.5px solid var(--ok); border-radius: 12px; background: var(--paper); color: var(--ok); font-size: 13px; font-weight: 700; text-decoration: none; }
  .n { margin-left: auto; font: 500 12px var(--mono); color: var(--muted); }
</style>
