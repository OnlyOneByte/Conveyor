<script lang="ts">
  import { chipName, groupName, groupVisible, shortName, type TrackJob, value, visible } from "#lib/track.js";

  export let jobs: TrackJob[];
  export let left: number | null = null;
  export let width = 0;
  const DONE = ["done", "failed", "canceled"];
  const fill = (job: TrackJob) => (DONE.includes(job.state) ? 1 : (job.progress ?? 0));
  $: job = jobs[0];
  $: style = left === null ? undefined : `left: ${left}px`;
</script>

{#if jobs.length > 1}
  <button type="button" class="chip grp" aria-expanded="false" {style} bind:offsetWidth={width}>
    <span class="stack" aria-hidden="true">{#each jobs as member (member.id)}<i class="ring" class:ind={member.state === "generating"} style="--p: {fill(member)}"></i>{/each}</span>
    {jobs.length} jobs <span class="v">{jobs.map(value).join(" · ")}<span class="sr">{groupName(jobs).slice(groupVisible(jobs).length)}</span></span>
  </button>
{:else if job}
  <a class="chip s-{job.state}" href="/history/{job.id}" {style} bind:offsetWidth={width}>
    <span class="ring" class:ind={job.state === "generating"} style="--p: {fill(job)}" aria-hidden="true"></span>
    <span class="t">{shortName(job.name)}</span> <span class="v">{value(job)}<span class="sr">{chipName(job).slice(visible(job).length)}</span></span>
  </a>
{/if}

<style>
  .chip { position: absolute; top: 8px; display: inline-flex; align-items: center; gap: var(--s2); height: 34px; min-width: 156px; padding: 0 var(--s3) 0 5px; border: 1px solid var(--line-2); border-radius: var(--r-chip); background: var(--paper); box-shadow: var(--lift); color: var(--ink); font: 650 13px / 1 var(--display); text-decoration: none; white-space: nowrap; transition: transform var(--t-fast), box-shadow var(--t-fast); }
  .chip:hover, .chip:focus-visible { transform: translateY(-3px); box-shadow: var(--lift-hi); z-index: 5; }
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
  @media (prefers-reduced-motion: reduce) { .chip:hover, .chip:focus-visible { transform: none; } }
</style>
