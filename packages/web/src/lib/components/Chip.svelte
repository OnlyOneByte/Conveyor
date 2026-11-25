<script lang="ts">
  import { tick } from "svelte";
  import {
    ACTIONS,
    chipName,
    groupName,
    groupVisible,
    shortName,
    status,
    type TrackJob,
    value,
    visible,
  } from "#lib/track.js";
  import { uid } from "#lib/ui/behaviour.js";

  export let jobs: TrackJob[];
  export let left: number | null = null;
  export let width = 0;
  export let tabindex = -1;
  export let index = -1;
  export let end = false;
  export let onAction: (job: TrackJob, action: string) => void = () => {};
  const card = uid("card");
  let slot: HTMLDivElement;
  let chip: HTMLElement;
  let open = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const DONE = ["done", "failed", "canceled"];
  const fill = (job: TrackJob) => (DONE.includes(job.state) ? 1 : (job.progress ?? 0));
  $: job = jobs[0];
  $: style = left === null ? undefined : `transform: translateX(${left}px)`;
  $: action = job && jobs.length === 1 ? ACTIONS[job.state] : undefined;

  function hover(on: boolean) {
    clearTimeout(timer);
    if (on) timer = setTimeout(() => (open = index >= 0), 300);
    else if (!slot.contains(document.activeElement)) open = false;
  }
  function blur(event: FocusEvent) {
    if (!(event.relatedTarget instanceof Node && slot.contains(event.relatedTarget))) open = false;
  }
  function keys(event: KeyboardEvent) {
    const inCard = event.target !== chip;
    if (event.key === "Escape" && open) open = false;
    else if (event.key === "ArrowDown" && !inCard) {
      open = index >= 0;
      void tick().then(() => slot.querySelector<HTMLElement>(".card a, .card button")?.focus());
    } else if (event.key === "ArrowUp" && inCard) chip.focus();
    else return;
    if (inCard && event.key === "Escape") chip.focus();
    event.preventDefault();
  }
  const dismiss = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open && !slot.contains(document.activeElement)) open = false;
  };
</script>

<svelte:window on:keydown={dismiss} />
<div class="slot" {style} role="presentation" bind:this={slot} on:mouseenter={() => hover(true)} on:mouseleave={() => hover(false)} on:focusin={() => (open = index >= 0)} on:focusout={blur} on:keydown={keys}>
  {#if jobs.length > 1}
    <button type="button" class="chip grp" aria-expanded={open} aria-controls={card} data-stop={index} {tabindex} bind:this={chip} bind:offsetWidth={width}>
      <span class="stack" aria-hidden="true">{#each jobs as member (member.id)}<i class="ring" class:ind={member.state === "generating"} style="--p: {fill(member)}"></i>{/each}</span>
      {jobs.length} jobs <span class="v">{jobs.map(value).join(" · ")}<span class="sr">{groupName(jobs).slice(groupVisible(jobs).length)}</span></span>
    </button>
  {:else if job}
    <a class="chip s-{job.state}" href="/jobs/{job.id}" aria-describedby={open ? `${card}-n ${card}-w` : undefined} data-stop={index} {tabindex} bind:this={chip} bind:offsetWidth={width}>
      <span class="ring" class:ind={job.state === "generating"} style="--p: {fill(job)}" aria-hidden="true"></span>
      <span class="t">{shortName(job.name)}</span> <span class="v">{value(job)}<span class="sr">{chipName(job).slice(visible(job).length)}</span></span>
    </a>
  {/if}
  {#if open && job}
    <div class="card" class:end id={card} style="--chip: {width}px">
      {#if jobs.length > 1}
        <ul>{#each jobs as member (member.id)}<li><a href="/jobs/{member.id}" data-stop tabindex="-1">{shortName(member.name)} <span class="v">{value(member)}<span class="sr">, {status(member)}</span></span></a></li>{/each}</ul>
      {:else}
        <p class="name" id="{card}-n">{job.name}</p>
        <p class="what" id="{card}-w">{status(job)} · {value(job)}</p>
        <p class="acts"><a class="btn" href="/jobs/{job.id}">Open job</a>{#if action}<button type="button" class="btn ghost" on:click={() => action && onAction(job, action)}>{action}</button>{/if}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .slot { position: absolute; top: 8px; left: 0; transition: transform var(--t-move) var(--ease-move); }
  .slot:focus-within { z-index: 5; }
  @media (hover: hover) { .slot:hover { z-index: 5; } }
  .chip { position: relative; display: inline-flex; align-items: center; gap: var(--s2); height: 34px; min-height: 34px; min-width: 156px; padding: 0 var(--s3) 0 5px; border: 1px solid var(--line-2); border-radius: var(--r-chip); background: var(--paper); box-shadow: var(--lift); color: var(--ink); font: 650 13px / 1 var(--display); text-decoration: none; white-space: nowrap; transition: transform var(--t-fast), box-shadow var(--t-fast); }
  .chip:focus-visible, .slot:focus-within .chip {
    transform: translateY(-3px); box-shadow: var(--lift-hi); z-index: 5;
  }
  @media (hover: hover) {
    .chip:hover { transform: translateY(-3px); box-shadow: var(--lift-hi); z-index: 5; }
  }
  .ring { --ring: var(--live); position: relative; flex: none; width: 24px; height: 24px; border-radius: 50%; background: conic-gradient(var(--ring) calc(var(--p) * 1turn), var(--line-2) 0); }
  .ring::before { content: ""; position: absolute; inset: 3px; border-radius: 50%; background: var(--paper); }
  .ring.ind { background: conic-gradient(var(--ring) 0 25%, var(--line-2) 0); }
  .t { max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
  .v { margin-left: auto; padding-left: var(--s1); font: 500 12px var(--mono); color: var(--live); }
  .s-done .ring { --ring: var(--ok); } .s-done .v { color: var(--ok); }
  .s-failed { border-color: var(--err); } .s-failed .ring { --ring: var(--err); } .s-failed .v { color: var(--err); }
  .s-canceled .ring { --ring: var(--off); } .s-canceled .t { color: var(--muted); text-decoration: line-through; } .s-canceled .v { color: var(--muted); }
  .s-queued { border-style: dashed; background: var(--sunk); box-shadow: none; } .s-queued .ring { background: none; border: 2px dashed var(--muted); } .s-queued .ring::before { display: none; } .s-queued .v { color: var(--muted); }
  .stack { display: flex; } .stack .ring { width: 22px; height: 22px; margin-left: -9px; box-shadow: 0 0 0 2px var(--paper); } .stack .ring:first-child { margin-left: 0; }
  .sr { font-size: 0; line-height: 0; }
  .card { position: absolute; top: 44px; left: 0; z-index: 10; min-width: 260px; padding: var(--s3); border: 1px solid var(--line-2); border-radius: var(--r-card); background: var(--paper); box-shadow: var(--lift-hi); }
  .card::before { content: ""; position: absolute; inset: -12px auto 100% 0; width: var(--chip); }
  .card.end { right: 0; left: auto; }
  .card.end::before { left: auto; right: 0; }
  .card p { margin: 0 0 var(--s2); } .name { font-weight: 700; } .what { color: var(--muted); font-size: var(--fs-chip); } .acts { display: flex; gap: var(--s2); margin: 0; }
  ul { display: grid; gap: var(--s1); margin: 0; padding: 0; list-style: none; } ul a { display: flex; gap: var(--s3); padding: var(--s1) var(--s2); border-radius: var(--r-control); color: var(--ink); text-decoration: none; } ul a:focus-visible { background: var(--sunk); }
  @media (prefers-reduced-motion: reduce) { .chip:hover, .chip:focus-visible, .slot:focus-within .chip { transform: none; } }
</style>
