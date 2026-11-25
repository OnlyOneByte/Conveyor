<script lang="ts">
  import { onMount } from "svelte";
  import { announce } from "#lib/announce.js";
  import { uploadStl } from "#lib/api.js";
  import { jobSent, titled } from "#lib/belt.js";
  import JobStatus from "#lib/components/JobStatus.svelte";
  import MakeMat from "#lib/components/MakeMat.svelte";
  import PrintAt from "#lib/components/PrintAt.svelte";
  import PrintDock from "#lib/components/PrintDock.svelte";
  import SchemaForm from "#lib/components/SchemaForm.svelte";
  import SourceTabs from "#lib/components/SourceTabs.svelte";
  import UploadDrop from "#lib/components/UploadDrop.svelte";
  import { jobName } from "#lib/job-settings.js";
  import { dockLine, errorText, latestOnly, measurements, uploadFailure } from "#lib/make.js";
  import { showMake } from "#lib/make-shown.js";
  import {
    AlreadyRetried,
    linkedRetry,
    type RerunPayload,
    sendJob,
    takeRerun,
  } from "#lib/rerun.js";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import type { PageData } from "./$types";

  export let data: PageData;

  const UPLOAD = "upload";
  const SENT_MS = 2500;

  $: generators = data.generators ?? [];
  $: pickable = generators.filter((g) => g.id !== "passthrough");
  $: tabs = [
    ...pickable.map((g) => ({ id: g.id, label: g.name })),
    { id: UPLOAD, label: "Upload STL" },
  ];

  let tab = "";
  let handoff: RerunPayload | null = null;
  let printerId = "";
  let profileId = "";
  let params: Record<string, unknown> = {};

  onMount(showMake);
  onMount(() => {
    const r = page.url.searchParams.get("rerun") ? takeRerun() : null;
    if (!r) return;
    ({ generatorId: tab, printerId, profileId } = r);
    handoff = r;
    if (r.params && typeof r.params === "object") params = { ...r.params };
  });

  $: if (!tab && generators.length) tab = tabs[0].id;
  $: upload = tab === UPLOAD;
  $: generatorId = upload ? "passthrough" : tab;
  $: gen = pickable.find((g) => g.id === tab) ?? null;
  $: retryOf = linkedRetry(handoff, upload ? "upload" : "generate", tab);

  $: eligible = data.printers.filter(
    (p) => !p.allowedGenerators || p.allowedGenerators.includes(generatorId),
  );
  $: if (eligible[0] && !eligible.some((p) => p.id === printerId)) printerId = eligible[0].id;
  $: printer = eligible.find((p) => p.id === printerId) ?? null;
  $: flavors = data.transports.find((t) => t.id === printer?.transportId)?.acceptsFlavors ?? [];
  $: compatible = data.profiles.filter((pr) => flavors.includes(pr.gcodeFlavor));
  $: if (compatible[0] && !compatible.some((pr) => pr.id === profileId))
    profileId = compatible[0].id;
  $: profile = compatible.find((pr) => pr.id === profileId);

  let file: File | null = null;
  let uploadId: string | null = null;
  let uploading = false;
  let uploadError = "";

  const uploads = latestOnly(uploadStl);

  async function choose(event: CustomEvent<File>) {
    const chosen = event.detail;
    clear();
    if (!chosen.name.toLowerCase().endsWith(".stl")) {
      uploadError = `${chosen.name} isn't an STL file. Choose a file whose name ends in .stl.`;
      return;
    }
    [file, uploading] = [chosen, true];
    const done = await uploads.run(chosen);
    if (!done) return;
    uploading = false;
    if (done.ok) uploadId = done.value.uploadId;
    else uploadError = `Couldn't upload ${chosen.name}: ${uploadFailure(done.error)}`;
  }

  function clear() {
    uploads.drop();
    [file, uploadId, uploading, uploadError] = [null, null, false, ""];
  }

  $: jobId = data.initialJobId ?? null;
  let busy = false;
  let sent = false;
  let last: { id: string; printer: string } | null = null;
  let error: string | null = null;
  let retried: string | null = null;

  $: made = jobName(gen?.name ?? titled(tab), params, null, gen?.ui ?? null);
  $: jobLabel = upload ? (file?.name ?? "Your STL") : made;
  $: summary = printer ? `${jobLabel} on ${printer.name}` : jobLabel;
  $: detail = dockLine(upload ? "" : measurements(params, gen?.ui ?? null), profile?.name);
  $: ready = !!printer && !!profile && (upload ? !!uploadId && !uploading : !!gen);

  async function print() {
    if (!ready || busy || !printer || !profile) return;
    busy = true;
    error = retried = null;
    const generator = upload
      ? { id: "passthrough", params: { uploadId, filename: file?.name ?? "" } }
      : { id: tab, params };
    try {
      const res = await sendJob({ generator, printerId, profileId }, retryOf);
      const to = `/?job=${encodeURIComponent(res.jobId)}`;
      await goto(to, { replace: true, reset: false });
      jobId = res.jobId;
      announce(`${jobLabel} sent to ${printer.name}.`);
      last = { id: res.jobId, printer: printer.name };
      jobSent();
      sent = true;
      setTimeout(() => (sent = false), SENT_MS);
    } catch (e) {
      error = errorText(e);
      retried = e instanceof AlreadyRetried ? e.retriedBy : null;
    } finally {
      busy = false;
      handoff = null;
    }
  }
</script>

<svelte:head><title>What are we making? · Conveyor</title></svelte:head>

<section class="make" aria-labelledby="make-title">
  <MakeMat preview={gen?.preview?.module === "gridfinity"} {params} {file} {upload} />
  <form class="order" on:submit|preventDefault={print}>
    <div class="fields">
      <h1 id="make-title">What are we making?</h1>
      {#if generators.length}
        <SourceTabs {tabs} bind:value={tab} panel="make-source" />
        <div id="make-source" role="tabpanel" aria-labelledby="tab-{tab}" class="questions">
          {#if upload}
            <section>
              <h2>Which file?</h2>
              <UploadDrop
                name={file?.name ?? ""} size={file?.size ?? 0} {uploading} ready={!!uploadId}
                error={uploadError} on:file={choose} on:clear={clear}
              />
            </section>
          {:else if gen}
            {#key gen.id}
              <SchemaForm
                schema={gen.paramSchema} ui={gen.ui ?? null} value={params}
                title="How big?" moreTitle="What's inside?" on:change={(e) => (params = e.detail)}
              />
            {/key}
          {/if}
        </div>
      {:else}
        <p class="note">
          Conveyor can't reach its server right now. Check that the api service is running.
        </p>
      {/if}
      <section id="make-where" class="where" tabindex="-1">
        <h2>Where should it print?</h2>
        {#if eligible.length}
          <PrintAt
            printers={eligible} profiles={compatible}
            hidden={data.printers.length - eligible.length} bind:printerId bind:profileId
          />
        {:else}
          <p class="note">No printer can print this yet. Add one on <a href="/printers">Printers</a>.</p>
        {/if}
      </section>
      {#if jobId}{#key jobId}
        <section class="job">
          <h3>Job</h3>
          <JobStatus {jobId} />
        </section>
      {/key}{/if}
    </div>
    <PrintDock {summary} {detail} {ready} {busy} {sent} {last} {error} {retried} />
  </form>
</section>

<style>
  .make {
    display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: 28px; align-items: start;
  }
  .order { min-width: 0; }
  .fields { display: flex; flex-direction: column; gap: var(--s5); }
  .where { outline: none; scroll-margin-top: var(--belt-h, 0px); }
  h1 { margin: 0; font-size: var(--fs-title); line-height: 1; letter-spacing: -0.04em; }
  h2 { margin: 0 0 10px; font-size: var(--fs-section); }
  h3 { margin: 0 0 var(--s2); font-size: var(--fs-body); }
  .questions { display: flex; flex-direction: column; gap: var(--s5); }
  .note { margin: 0; color: var(--muted); }
  .job {
    padding: var(--s4); border: 1px solid var(--line); border-radius: var(--r-card);
    background: var(--paper);
  }
  @media (min-width: 1200px) {
    .make { grid-template-columns: minmax(0, 1fr) minmax(0, 1.45fr); }
    .fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--s5); }
    .fields > :global(*) { grid-column: 1 / -1; }
    .fields > .questions { grid-column: 1; }
    .fields > .where { grid-column: 2; grid-row: 3; }
  }
  @media (max-width: 759px) {
    .make { grid-template-columns: minmax(0, 1fr); gap: 18px; }
    .order { padding-bottom: calc(var(--dock-h, 120px) + var(--s4)); }
  }
</style>
