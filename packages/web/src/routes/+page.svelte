<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { announce } from "#lib/announce.js";
  import { uploadStl } from "#lib/api.js";
  import { titled } from "#lib/belt.js";
  import JobStatus from "#lib/components/JobStatus.svelte";
  import MakeMat from "#lib/components/MakeMat.svelte";
  import PrintAt from "#lib/components/PrintAt.svelte";
  import PrintDock from "#lib/components/PrintDock.svelte";
  import SchemaForm from "#lib/components/SchemaForm.svelte";
  import SourceTabs from "#lib/components/SourceTabs.svelte";
  import UploadDrop from "#lib/components/UploadDrop.svelte";
  import { jobName } from "#lib/job-settings.js";
  import { dockLine, measurements } from "#lib/make.js";
  import { rememberJob, updateJobState } from "#lib/recent-jobs.js";
  import {
    AlreadyRetried, linkedRetry, type RerunPayload, sendJob, takeRerun,
  } from "#lib/rerun.js";
  import type { PageData } from "./$types";

  export let data: PageData;

  const UPLOAD = "upload";
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
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

  onMount(() => {
    const r = page.url.searchParams.get("rerun") ? takeRerun() : null;
    if (!r) return;
    tab = r.generatorId;
    printerId = r.printerId;
    profileId = r.profileId;
    handoff = r;
    if (r.params && typeof r.params === "object") params = { ...r.params };
  });

  $: if (!tab && pickable[0]) tab = pickable[0].id;
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

  async function choose(event: CustomEvent<File>) {
    const chosen = event.detail;
    uploadError = "";
    uploadId = null;
    if (!chosen.name.toLowerCase().endsWith(".stl")) {
      file = null;
      uploadError = `${chosen.name} isn't an STL file. Choose a file whose name ends in .stl.`;
      return;
    }
    file = chosen;
    uploading = true;
    uploadId = await uploadStl(chosen).then(
      (res) => res.uploadId,
      (e: unknown) => ((uploadError = `Couldn't upload ${chosen.name}: ${message(e)}`), null),
    );
    uploading = false;
  }

  $: jobId = data.initialJobId ?? null;
  let busy = false;
  let sent = false;
  let error: string | null = null;
  let retried: string | null = null;

  $: made = jobName(gen?.name ?? titled(tab), params, null, gen?.ui ?? null);
  $: name = upload ? (file?.name ?? "Your STL") : made;
  $: summary = printer ? `${name} on ${printer.name}` : name;
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
      await goto(`/?job=${encodeURIComponent(res.jobId)}`, { replaceState: true });
      jobId = res.jobId;
      const targetName = `${printer.name} · ${profile.name}`;
      const submittedAt = Date.now();
      const { id } = generator;
      rememberJob({ jobId: res.jobId, targetName, generatorId: id, submittedAt, state: "queued" });
      announce(`${name} sent to ${printer.name}.`);
      sent = true;
      setTimeout(() => (sent = false), SENT_MS);
    } catch (e) {
      error = message(e);
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
    <h1 id="make-title">What are we making?</h1>
    {#if generators.length}
      <SourceTabs {tabs} bind:value={tab} panel="make-source" />
      <div id="make-source" role="tabpanel" aria-labelledby="tab-{tab}" class="questions">
        {#if upload}
          <section>
            <h2>Which file?</h2>
            <UploadDrop
              name={file?.name ?? ""} {uploading} ready={!!uploadId} error={uploadError}
              on:file={choose}
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
    <section>
      <h2>Where should it print?</h2>
      {#if eligible.length}
        <PrintAt
          printers={eligible} profiles={compatible} hidden={data.printers.length - eligible.length}
          bind:printerId bind:profileId
        />
      {:else}
        <p class="note">No printer can print this yet. Add one in Settings.</p>
      {/if}
    </section>
    {#if error}
      <p class="err" role="alert">
        {error} {#if retried}<a href="/jobs/{retried}">See the retry</a>{/if}
      </p>
    {/if}
    {#if jobId}{#key jobId}
      <section class="job">
        <h3>Job</h3>
        <JobStatus {jobId} on:state={(e) => updateJobState(e.detail.jobId, e.detail.state)} />
      </section>
    {/key}{/if}
    <PrintDock {summary} {detail} {ready} {busy} {sent} />
  </form>
</section>

<style>
  .make {
    display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: 28px; align-items: start;
  }
  .order { display: flex; flex-direction: column; gap: var(--s5); min-width: 0; }
  h1 { margin: 0; font-size: var(--fs-title); line-height: 1; letter-spacing: -0.04em; }
  h2 { margin: 0 0 10px; font-size: var(--fs-section); }
  h3 { margin: 0 0 var(--s2); font-size: var(--fs-body); }
  .questions { display: flex; flex-direction: column; gap: var(--s5); }
  .note { margin: 0; color: var(--muted); }
  .err { margin: 0; color: var(--err); font-weight: 600; }
  .job {
    padding: var(--s4); border: 1px solid var(--line); border-radius: var(--r-card);
    background: var(--paper);
  }
  @media (max-width: 759px) {
    .make { grid-template-columns: minmax(0, 1fr); gap: 18px; }
    .order { padding-bottom: 96px; }
  }
</style>
