<script lang="ts">
  import { onDestroy } from "svelte";
  import { openJobSocket, fetchJobSnapshot, type JobStatusEvent } from "$lib/api";
  import type { JobState } from "@conveyor/shared";

  export let jobId: string;

  const STAGES: { state: JobState; label: string }[] = [
    { state: "queued", label: "Queued" },
    { state: "generating", label: "Generating" },
    { state: "slicing", label: "Slicing" },
    { state: "transferring", label: "Transferring" },
    { state: "printing", label: "Printing" },
    { state: "done", label: "Done" },
  ];
  const ORDER: JobState[] = ["queued", "generating", "slicing", "transferring", "printing", "done"];

  let evt: JobStatusEvent | null = null;
  let ws: WebSocket | null = null;

  $: if (jobId) connect(jobId);

  function connect(id: string) {
    ws?.close();
    // Reconnect-safe: pull the snapshot first, then stream live.
    fetchJobSnapshot(id).then((s) => { if (s && !evt) evt = s; }).catch(() => {});
    ws = openJobSocket(id);
    ws.onmessage = (m) => { evt = JSON.parse(m.data); };
    ws.onerror = () => {};
  }

  onDestroy(() => ws?.close());

  function stageIndex(s: JobState | undefined): number {
    if (!s) return -1;
    if (s === "failed" || s === "canceled") return -1;
    return ORDER.indexOf(s);
  }

  $: idx = stageIndex(evt?.state);
  $: failed = evt?.state === "failed";
  $: pct = Math.round((evt?.progress ?? 0) * 100);
</script>

<div class="status">
  {#if !evt}
    <p class="muted">Connecting…</p>
  {:else if failed}
    <div class="failed">
      <strong>✕ Failed</strong>
      <span class="muted">{evt.error?.stage}: {evt.error?.reason ?? evt.message}</span>
    </div>
  {:else}
    <ol class="stages">
      {#each STAGES as s, i}
        <li class:done={i < idx || evt.state === "done"} class:active={i === idx && evt.state !== "done"}>
          <span class="dot" />
          {s.label}
        </li>
      {/each}
    </ol>
    {#if evt.state === "printing"}
      <div class="bar"><div class="fill" style={`width:${pct}%`} /></div>
      <span class="muted">{pct}%</span>
    {/if}
  {/if}
</div>

<style>
  .status { display: flex; flex-direction: column; gap: 0.75rem; }
  .stages { list-style: none; display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; padding: 0; margin: 0; }
  .stages li { display: flex; align-items: center; gap: 0.4rem; color: var(--muted); font-size: 0.9rem; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--border); }
  .stages li.done { color: var(--ok); }
  .stages li.done .dot { background: var(--ok); }
  .stages li.active { color: var(--accent); }
  .stages li.active .dot { background: var(--accent); animation: pulse 1s infinite; }
  @keyframes pulse { 50% { opacity: 0.3; } }
  .bar { height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; }
  .fill { height: 100%; background: var(--accent); transition: width 0.3s; }
  .failed { display: flex; flex-direction: column; gap: 0.2rem; color: var(--danger); }
</style>
