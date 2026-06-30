<script lang="ts">
  import { onMount } from "svelte";
  import { Canvas } from "@threlte/core";
  import PreviewScene from "$lib/components/PreviewScene.svelte";
  import MeshScene from "$lib/components/MeshScene.svelte";
  import SchemaForm from "$lib/components/SchemaForm.svelte";
  import JobStatus from "$lib/components/JobStatus.svelte";
  import { submitJob, uploadStl, fetchGenerators, fetchStations, type StationSummary } from "$lib/api";
  import RecentJobs from "$lib/components/RecentJobs.svelte";
  import { rememberJob, updateJobState } from "$lib/recent-jobs";
  import type { PageData } from "./$types";

  export let data: PageData;

  // Seed from the loader, but refetch on mount: the +page.ts load runs before the
  // layout's auth gate clears, so it can 401 to []. Refetching here (the page is
  // only rendered post-auth) guarantees a populated catalog.
  let generators = data.generators ?? [];
  let stations = data.stations ?? [];

  onMount(async () => {
    if (generators.length && stations.length) return;
    const [g, s] = await Promise.all([
      fetchGenerators().catch(() => generators),
      fetchStations().catch(() => stations),
    ]);
    generators = g;
    stations = s;
  });

  // Only generators with a config form / preview belong in the "Generate" dropdown.
  // The passthrough generator is driven by the "Upload STL" tab, not picked here.
  $: pickableGenerators = generators.filter((g) => g.id !== "passthrough");

  // Source: generate from a generator, or upload an STL (passthrough generator).
  type Source = "generate" | "upload";
  let source: Source = "generate";

  let selectedGenId = "";
  let selectedStationId = "";
  let params: Record<string, unknown> = {};

  // Default the pickers once the catalog arrives (load resolves after first paint
  // because ssr=false). Only fill empty selections so user choices stick.
  $: if (!selectedGenId && pickableGenerators.length) selectedGenId = pickableGenerators[0].id;
  $: if (!selectedStationId && stations.length) selectedStationId = stations[0].id;

  $: selectedGen = generators.find((g) => g.id === selectedGenId) ?? null;

  // Only the gridfinity generator has a procedural preview wired today; others
  // fall back to a generic message (the preview module is per-generator).
  $: hasPreview = source === "generate" && selectedGen?.preview?.module === "gridfinity";

  // ── Upload state ──────────────────────────────────────────────
  let uploadFile: File | null = null; // local File → real-mesh preview
  let uploadId: string | null = null; // server ref → passthrough job param
  let uploadName = "";
  let uploading = false;
  let dragOver = false;

  async function onFile(f: File | null | undefined) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".stl")) {
      error = "Please choose an .stl file.";
      return;
    }
    error = null;
    uploadFile = f; // render the real mesh immediately (client-side)
    uploadName = f.name;
    uploading = true;
    uploadId = null;
    try {
      const res = await uploadStl(f); // then persist server-side for printing
      uploadId = res.uploadId;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      uploading = false;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    onFile(e.dataTransfer?.files?.[0]);
  }

  let submitting = false;
  let jobId: string | null = null;
  let error: string | null = null;

  // Can we submit? Generate needs a generator; Upload needs a finished upload.
  $: canPrint =
    !!selectedStationId &&
    !submitting &&
    (source === "generate" ? !!selectedGen : !!uploadId && !uploading);

  async function print() {
    if (!selectedStationId) return;
    if (source === "generate" && !selectedGen) return;
    if (source === "upload" && !uploadId) return;
    submitting = true;
    error = null;
    jobId = null;
    try {
      const generator =
        source === "upload"
          ? { id: "passthrough", params: { uploadId, filename: uploadName } }
          : { id: selectedGen!.id, params };
      const res = await submitJob({ generator, stationId: selectedStationId });
      jobId = res.jobId;
      // Persist to the browser's recent-jobs memory so a refresh keeps it visible.
      const station = stations.find((s) => s.id === selectedStationId);
      rememberJob({
        jobId: res.jobId,
        stationName: station?.name ?? selectedStationId,
        generatorId: generator.id,
        submittedAt: Date.now(),
        state: "queued",
      });
    } catch (e) {
      error = (e as Error).message;
    } finally {
      submitting = false;
    }
  }

  // Real chips from the structured station summary (flavor/material/quality come
  // from the bound profile, server-side — no more regex-on-name guessing). Order:
  // flavor → material → quality, skipping any the station doesn't carry.
  function chips(s: StationSummary): string[] {
    const out: string[] = [];
    if (s.gcodeFlavor) out.push(titleCase(s.gcodeFlavor));
    if (s.material) out.push(s.material);
    if (s.quality) out.push(s.quality);
    return out;
  }
  function titleCase(v: string): string {
    return v.charAt(0).toUpperCase() + v.slice(1);
  }

  // The preset dot encodes the gcode flavor (what the station actually prints to),
  // not a random index — same flavor, same color across the list.
  function dotColor(s: StationSummary): string {
    switch (s.gcodeFlavor?.toLowerCase()) {
      case "klipper":
        return "var(--accent)"; // teal
      case "marlin":
      case "marlin2":
        return "#fbbf24"; // amber
      default:
        return "var(--muted)"; // unknown / dangling profile
    }
  }
</script>

<div class="layout">
  <!-- Live preview: the wicked-fast client-side viewport (DOM-first so it pins on top in mobile) -->
  <section class="card viewport">
    {#if hasPreview}
      <Canvas>
        <PreviewScene {params} />
      </Canvas>
      <span class="badge">live preview</span>
    {:else if source === "upload" && uploadFile}
      <Canvas>
        <MeshScene file={uploadFile} />
      </Canvas>
      <span class="badge">uploaded mesh</span>
    {:else if source === "upload"}
      <div class="noview muted">
        <p>Your STL renders here once selected.</p>
        <p>Drop a file in the Upload panel →</p>
      </div>
    {:else}
      <div class="noview muted">
        <p>No live preview for this generator.</p>
        <p>The exact model is generated server-side at print time.</p>
      </div>
    {/if}
  </section>

  <!-- Config panel -->
  <section class="panel">
    <!-- ① SOURCE -->
    <div class="card">
      <h3><span class="step-n">1</span>Source</h3>
      <div class="seg" role="tablist" aria-label="Model source">
        <button
          role="tab"
          id="tab-generate"
          aria-selected={source === "generate"}
          aria-controls="source-panel"
          tabindex={source === "generate" ? 0 : -1}
          class:active={source === "generate"}
          on:click={() => (source = "generate")}>Generate</button>
        <button
          role="tab"
          id="tab-upload"
          aria-selected={source === "upload"}
          aria-controls="source-panel"
          tabindex={source === "upload" ? 0 : -1}
          class:active={source === "upload"}
          on:click={() => (source = "upload")}>Upload STL</button>
      </div>

      <div
        id="source-panel"
        role="tabpanel"
        aria-labelledby={source === "generate" ? "tab-generate" : "tab-upload"}
      >
      {#if source === "generate"}
        <label class="pick">
          <span class="muted">Generator</span>
          <select bind:value={selectedGenId}>
            {#each pickableGenerators as g}<option value={g.id}>{g.name}</option>{/each}
          </select>
        </label>
      {:else}
        <label
          class="drop"
          class:over={dragOver}
          on:dragover|preventDefault={() => (dragOver = true)}
          on:dragleave={() => (dragOver = false)}
          on:drop={onDrop}
        >
          <input
            type="file"
            accept=".stl"
            class="file-input"
            on:change={(e) => onFile(e.currentTarget.files?.[0])}
          />
          {#if uploading}
            <p><strong>Uploading…</strong></p>
            <p class="muted">{uploadName}</p>
          {:else if uploadId}
            <p><strong>✓ {uploadName}</strong></p>
            <p class="muted">Ready to print — choose a station below.</p>
          {:else}
            <p><strong>Drop an STL</strong> or click to browse</p>
            <p class="muted">The real mesh renders in the preview.</p>
          {/if}
        </label>
      {/if}
      </div>
    </div>

    <!-- ② CONFIGURE -->
    {#if source === "generate"}
      <div class="card">
        <h3><span class="step-n">2</span>Configure</h3>
        {#if selectedGen}
          <SchemaForm schema={selectedGen.paramSchema} on:change={(e) => (params = e.detail)} />
        {/if}
      </div>
    {/if}

    <!-- ③ PRINT AT -->
    <div class="card">
      <h3><span class="step-n">3</span>Print at</h3>
      {#if stations.length}
        <div class="presets" role="radiogroup" aria-label="Choose a station">
          {#each stations as s}
            <button
              type="button"
              class="preset"
              class:sel={s.id === selectedStationId}
              role="radio"
              aria-checked={s.id === selectedStationId}
              on:click={() => (selectedStationId = s.id)}
            >
              <span class="dot" style={`background:${dotColor(s)}`} title={s.gcodeFlavor ?? "unknown flavor"} />
              <span class="pmeta">
                <span class="pn">{s.name}</span>
                {#if chips(s).length}
                  <span class="chips">{#each chips(s) as c}<span class="chip">{c}</span>{/each}</span>
                {/if}
              </span>
              <span class="check">✓</span>
            </button>
          {/each}
        </div>
      {:else}
        <p class="muted">No stations configured.</p>
      {/if}

      <button class="primary print desktop-print" on:click={print} disabled={!canPrint}>
        {submitting ? "Submitting…" : "Print"}
      </button>
      {#if error}<p class="err">{error}</p>{/if}
    </div>

    {#if jobId}
      <div class="card">
        <h3>Job</h3>
        <JobStatus {jobId} on:state={(e) => updateJobState(e.detail.jobId, e.detail.state)} />
      </div>
    {/if}

    <!-- ④ RECENT JOBS — persisted per-browser so a refresh keeps them visible -->
    <div class="card">
      <h3>Recent jobs</h3>
      <RecentJobs activeJobId={jobId} onSelect={(id) => (jobId = id)} />
    </div>

    {#if generators.length === 0}
      <div class="card muted">
        API unreachable — start the api service (and redis). See README.
      </div>
    {/if}
  </section>
</div>

<!-- mobile sticky CTA -->
<div class="mobile-cta">
  <button class="primary" on:click={print} disabled={!canPrint}>
    {submitting ? "Submitting…" : "Print"}
  </button>
</div>

<style>
  .layout { display: grid; grid-template-columns: 1fr 1.4fr; gap: 1.25rem; align-items: start; }
  /* Config panel on the left, viewport on the right (DOM order keeps viewport
     first so it stays on top when the layout collapses to one column). */
  .panel { order: 1; }
  .viewport { order: 2; }

  .viewport {
    position: relative; height: 60vh; min-height: 360px; padding: 0; overflow: hidden; position: sticky; top: 1rem;
    /* Depth backdrop from the locked mockup — replaces the flat .card surface so
       the empty state and 3D viewport both sit on a subtle dome of light. */
    background: radial-gradient(120% 120% at 50% 0%, #1b2230 0%, #0e1116 70%);
  }
  .badge {
    position: absolute; top: 0.75rem; left: 0.75rem; font-size: 0.75rem;
    background: rgba(94,234,212,0.15); color: var(--accent);
    padding: 0.2rem 0.5rem; border-radius: 6px; border: 1px solid var(--accent-dim);
  }
  .noview { height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; gap: 0.25rem; }
  .panel { display: flex; flex-direction: column; gap: 1rem; }

  h3 { margin: 0 0 0.75rem; font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); display: flex; align-items: center; }
  .step-n {
    display: inline-flex; width: 1.4rem; height: 1.4rem; border-radius: 50%;
    background: var(--surface-2); color: var(--accent); align-items: center; justify-content: center;
    font-size: 0.8rem; font-weight: 700; margin-right: 0.5rem;
  }

  /* segmented source toggle */
  .seg { display: flex; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 0.25rem; gap: 0.25rem; margin-bottom: 0.85rem; }
  .seg button { flex: 1; border: none; background: transparent; border-radius: 7px; min-height: 38px; }
  .seg button.active { background: var(--accent); color: #04211d; font-weight: 700; }

  .pick { display: flex; flex-direction: column; gap: 0.3rem; }
  .pick span { font-size: 0.85rem; }

  .drop { display: block; position: relative; border: 2px dashed var(--border); border-radius: 10px; padding: 1.5rem 1rem; text-align: center; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
  .drop:hover, .drop.over { border-color: var(--accent); background: rgba(94,234,212,0.06); }
  .drop p { margin: 0.2rem 0; }
  .drop strong { color: var(--accent); }
  /* native input fills the dropzone but stays invisible (the label is the UI) */
  .file-input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }

  /* preset cards */
  .presets { display: flex; flex-direction: column; gap: 0.6rem; }
  .preset {
    display: flex; align-items: center; gap: 0.7rem; text-align: left; width: 100%;
    border: 1px solid var(--border); background: var(--surface-2);
    border-radius: 10px; padding: 0.7rem 0.8rem; cursor: pointer;
  }
  .preset:hover { border-color: var(--accent-dim); }
  .preset.sel { border-color: var(--accent); background: rgba(94,234,212,0.08); }
  .preset .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .pmeta { display: flex; flex-direction: column; gap: 0.2rem; }
  .preset .pn { font-weight: 600; color: var(--text); }
  .chips { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  .chip { font-size: 0.7rem; background: var(--surface); border: 1px solid var(--border); border-radius: 99px; padding: 0.05rem 0.5rem; color: var(--muted); }
  .preset .check { margin-left: auto; color: var(--accent); opacity: 0; font-weight: 700; }
  .preset.sel .check { opacity: 1; }

  .print { width: 100%; margin-top: 0.85rem; }
  .err { color: var(--danger); font-size: 0.85rem; margin: 0.5rem 0 0; }

  /* mobile */
  .mobile-cta { display: none; }
  @media (max-width: 820px) {
    .layout { grid-template-columns: 1fr; padding-bottom: 4.5rem; }
    .viewport { order: 0; position: sticky; top: 0.5rem; height: 40vh; min-height: 0; } /* preview back on top for mobile */
    .panel { order: 1; }
    .desktop-print { display: none; }
    .mobile-cta {
      display: block; position: fixed; left: 0; right: 0; bottom: 0; padding: 0.7rem 1rem;
      background: linear-gradient(transparent, var(--bg) 35%); z-index: 30;
    }
    .mobile-cta button { width: 100%; font-size: 1.05rem; }
  }
</style>
