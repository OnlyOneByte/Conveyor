<script lang="ts">
  import { shortName, type TrackJob } from "#lib/track.js";
  import { uid } from "#lib/ui/behaviour.js";

  export let jobs: TrackJob[];
  export let onAction: (job: TrackJob, action: string) => void;
  const tray = uid("tray");
  const ACTIONS = ["Retry", "Pick printer", "Dismiss"];
  let open = false;
  let button: HTMLButtonElement;
  function keys(event: KeyboardEvent) {
    if (event.key !== "Escape" || !open) return;
    open = false;
    button.focus();
  }
</script>

<div class="wrap" role="presentation" on:keydown={keys}>
  <button type="button" class="needs" aria-expanded={open} aria-controls={tray} bind:this={button} on:click={() => (open = !open)}>Needs you<span class="n">{jobs.length}</span></button>
  {#if open}
    <ul class="tray" id={tray}>
      {#each jobs as job (job.id)}
        <li>
          <a href="/history/{job.id}">{shortName(job.name)}</a> {#if job.printer}<span class="on">on {job.printer}</span>{/if}
          <p>{job.reason ?? "It stopped without giving a reason."}</p>
          <p class="acts">{#each ACTIONS as action (action)}<button type="button" class="btn" class:ghost={action !== "Retry"} on:click={() => onAction(job, action)}>{action}</button>{/each}</p>
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
