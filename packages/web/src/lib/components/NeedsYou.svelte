<script lang="ts">
  import { tick } from "svelte";
  import { shortName, type TrackJob } from "#lib/track.js";
  import { uid } from "#lib/ui/behaviour.js";

  export let jobs: TrackJob[];
  export let onAction: (job: TrackJob, action: string) => unknown;
  const tray = uid("tray");
  const ACTIONS = ["Retry", "Pick printer", "Dismiss"];
  let open = false;
  let wrap: HTMLDivElement;
  let button: HTMLButtonElement;

  async function run(job: TrackJob, action: string, at: number) {
    const bins = wrap.parentElement;
    await onAction(job, action);
    await tick();
    const items = wrap?.isConnected ? [...wrap.querySelectorAll<HTMLElement>(".tray li")] : [];
    const next = (items[at] ?? items[at - 1])?.querySelector("button");
    (next ?? (wrap?.isConnected ? button : bins?.querySelector("a")))?.focus();
  }
  function dismiss(event: Event) {
    if (!open) return;
    if (event instanceof KeyboardEvent && event.key === "Escape") {
      if (wrap.contains(document.activeElement)) button.focus();
      open = false;
    } else if (event.type === "pointerdown" && event.target instanceof Node && !wrap.contains(event.target)) open = false;
  }
</script>

<svelte:window on:keydown={dismiss} on:pointerdown={dismiss} />
<div class="wrap" bind:this={wrap}>
  <button type="button" class="needs" aria-expanded={open} aria-controls={tray} bind:this={button} on:click={() => (open = !open)}>Needs you<span class="n">{jobs.length}</span></button>
  {#if open}
    <ul class="tray" id={tray}>
      {#each jobs as job, at (job.id)}
        <li>
          <a href="/jobs/{job.id}">{shortName(job.name)}</a> {#if job.printer}<span class="on">on {job.printer}</span>{/if}
          <p>{job.reason ?? "It stopped without giving a reason."}</p>
          <p class="acts">{#each ACTIONS as action (action)}<button type="button" class="btn" class:ghost={action !== "Retry"} on:click={() => run(job, action, at)}>{action}</button>{/each}</p>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .wrap { position: relative; }
  .needs { display: flex; align-items: center; gap: var(--s2); width: 100%; min-height: 38px; padding: 0 10px; border: 1.5px solid var(--err); border-radius: 12px; background: var(--paper); color: var(--err); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
  .n { margin-left: auto; font: 500 12px var(--mono); }
  .tray { position: absolute; top: calc(100% + 6px); right: 0; z-index: 10; display: grid; gap: var(--s3); width: 300px; margin: 0; padding: var(--s3); list-style: none; border: 1px solid var(--line-2); border-radius: var(--r-card); background: var(--paper); box-shadow: var(--lift-hi); }
  .tray a { font-weight: 700; color: var(--ink); }
  .on { color: var(--muted); font-size: var(--fs-chip); }
  .tray p { margin: var(--s1) 0 0; font-size: var(--fs-chip); }
  .acts { display: flex; flex-wrap: wrap; gap: var(--s2); }
</style>
