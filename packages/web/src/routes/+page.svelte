<script lang="ts">
  import { Canvas } from "@threlte/core";
  import PreviewScene from "$lib/components/PreviewScene.svelte";
  import SchemaForm from "$lib/components/SchemaForm.svelte";
  import JobStatus from "$lib/components/JobStatus.svelte";
  import { submitJob } from "$lib/api";
  import type { PageData } from "./$types";

  export let data: PageData;

  $: generators = data.generators ?? [];
  $: stations = data.stations ?? [];

  let selectedGenId = "";
  let selectedStationId = "";
  let params: Record<string, unknown> = {};

  // Default the pickers once the catalog arrives (load resolves after first paint
  // because ssr=false). Only fill empty selections so user choices stick.
  $: if (!selectedGenId && generators.length) selectedGenId = generators[0].id;
  $: if (!selectedStationId && stations.length) selectedStationId = stations[0].id;

  $: selectedGen = generators.find((g) => g.id === selectedGenId) ?? null;

  // Only the gridfinity generator has a procedural preview wired today; others
  // fall back to a generic message (the preview module is per-generator).
  $: hasPreview = selectedGen?.preview?.module === "gridfinity";

  let submitting = false;
  let jobId: string | null = null;
  let error: string | null = null;

  async function print() {
    if (!selectedGen || !selectedStationId) return;
    submitting = true;
    error = null;
    jobId = null;
    try {
      const res = await submitJob({
        generator: { id: selectedGen.id, params },
        stationId: selectedStationId,
      });
      jobId = res.jobId;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      submitting = false;
    }
  }
</script>

<div class="layout">
  <!-- Live preview: the wicked-fast client-side viewport -->
  <section class="card viewport">
    {#if hasPreview}
      <Canvas>
        <PreviewScene {params} />
      </Canvas>
      <span class="badge">live preview</span>
    {:else}
      <div class="noview muted">
        <p>No live preview for this generator.</p>
        <p>The exact model is generated server-side at print time.</p>
      </div>
    {/if}
  </section>

  <!-- Config panel -->
  <section class="panel">
    <div class="card">
      <label class="pick">
        <span class="muted">Make</span>
        <select bind:value={selectedGenId}>
          {#each generators as g}<option value={g.id}>{g.name}</option>{/each}
        </select>
      </label>
    </div>

    <div class="card">
      <h3>Configure</h3>
      {#if selectedGen}
        <SchemaForm schema={selectedGen.paramSchema} on:change={(e) => (params = e.detail)} />
      {/if}
    </div>

    <div class="card">
      <label class="pick">
        <span class="muted">Print at</span>
        <select bind:value={selectedStationId}>
          {#each stations as s}<option value={s.id}>{s.name}</option>{/each}
        </select>
      </label>
      <button class="primary print" on:click={print} disabled={submitting || !selectedStationId}>
        {submitting ? "Submitting…" : "Print"}
      </button>
      {#if error}<p class="err">{error}</p>{/if}
    </div>

    {#if jobId}
      <div class="card">
        <h3>Job</h3>
        <JobStatus {jobId} />
      </div>
    {/if}

    {#if generators.length === 0}
      <div class="card muted">
        API unreachable — start the api service (and redis). See README.
      </div>
    {/if}
  </section>
</div>

<style>
  .layout { display: grid; grid-template-columns: 1.4fr 1fr; gap: 1.25rem; align-items: start; }
  @media (max-width: 820px) { .layout { grid-template-columns: 1fr; } }

  .viewport { position: relative; height: 60vh; min-height: 360px; padding: 0; overflow: hidden; }
  .badge {
    position: absolute; top: 0.75rem; left: 0.75rem; font-size: 0.75rem;
    background: rgba(94,234,212,0.15); color: var(--accent);
    padding: 0.2rem 0.5rem; border-radius: 6px; border: 1px solid var(--accent-dim);
  }
  .noview { height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; gap: 0.25rem; }
  .panel { display: flex; flex-direction: column; gap: 1rem; }
  .pick { display: flex; flex-direction: column; gap: 0.3rem; }
  .pick span { font-size: 0.85rem; }
  .print { width: 100%; margin-top: 0.85rem; }
  .err { color: var(--danger); font-size: 0.85rem; margin: 0.5rem 0 0; }
  h3 { margin: 0 0 0.75rem; font-size: 1rem; }
</style>
