<script lang="ts">
  import { onMount } from "svelte";
  import { announce } from "#lib/announce.js";
  import { uploadStl } from "#lib/api.js";
  import { titled } from "#lib/belt.js";
  import MakeDown from "#lib/components/MakeDown.svelte";
  import MakeMat from "#lib/components/MakeMat.svelte";
  import SourceTabs from "#lib/components/SourceTabs.svelte";
  import { jobName } from "#lib/job-settings.js";
  import { dockLine, EMPTY_CATALOG, knownParams, latestOnly, measurements } from "#lib/make.js";
  import { showMake } from "#lib/make-shown.js";
  import { printJob } from "#lib/print-job.js";
  import { linkedRetry, type RerunPayload, takeRerun } from "#lib/rerun.js";
  import { failed } from "#lib/said.js";
  import Skeleton from "#lib/ui/Skeleton.svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import type { PageData } from "./$types";

  export let data: PageData;

  let cat: Awaited<PageData["catalog"]> | null = null;
  const take = (p: PageData["catalog"]) => p.then((c) => (cat = p === data.catalog ? c : cat));
  $: void take(data.catalog);
  $: ({ generators, printers, printersFailed: down, profiles, transports } = cat ?? EMPTY_CATALOG);

  const UPLOAD = "upload";

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
  onMount(async () => {
    const r = page.url.searchParams.get("rerun") ? takeRerun() : null;
    if (!r) return;
    tab = r.generatorId;
    [printerId, profileId, handoff] = [r.printerId, r.profileId, r];
    const known = (await data.catalog).generators.find((g) => g.id === r.generatorId);
    const schema = known?.paramSchema ?? null;
    params = knownParams(r.params, schema);
  });

  $: if (!tab && generators.length) tab = tabs[0].id;
  $: upload = tab === UPLOAD;
  $: generatorId = upload ? "passthrough" : tab;
  $: gen = pickable.find((g) => g.id === tab) ?? null;
  $: retryOf = linkedRetry(handoff, upload ? "upload" : "generate", tab);

  $: eligible = printers.filter(
    (p) => !p.allowedGenerators || p.allowedGenerators.includes(generatorId),
  );
  $: if (eligible[0] && !eligible.some((p) => p.id === printerId)) printerId = eligible[0].id;
  $: printer = eligible.find((p) => p.id === printerId) ?? null;
  $: flavors = transports.find((t) => t.id === printer?.transportId)?.acceptsFlavors ?? [];
  $: compatible = profiles.filter((pr) => flavors.includes(pr.gcodeFlavor));
  $: if (compatible[0] && !compatible.some((pr) => pr.id === profileId))
    profileId = compatible[0].id;
  $: profile = compatible.find((pr) => pr.id === profileId);

  let [file, uploadId]: [File | null, string | null] = [null, null];
  let [uploading, uploadError] = [false, ""];
  let uploadWhy: string | null = null;

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
    if (!done.ok) {
      [file, [uploadError, uploadWhy]] = [null, failed(`upload ${chosen.name}`, done.error)];
      return;
    }
    uploadId = done.value.uploadId;
    announce(`${chosen.name} is uploaded and ready to print.`);
  }

  function clear() {
    uploads.drop();
    [file, uploadId, uploading, uploadError, uploadWhy] = [null, null, false, "", null];
  }

  const job = printJob((to) => goto(to, { replace: true, reset: false }));

  $: made = jobName(gen?.name ?? titled(tab), params, null, gen?.ui ?? null);
  $: jobLabel = upload ? (file?.name ?? "Your STL") : made;
  $: summary = printer ? `${jobLabel} on ${printer.name}` : jobLabel;
  $: setup = printers.length ? "" : down ? "Printers didn't load" : "Add a printer, then print.";
  $: detail = dockLine(upload ? "" : measurements(params, gen?.ui ?? null), profile?.name ?? setup);
  $: ready = !!printer && !!profile && (upload ? !!uploadId && !uploading : !!gen);

  async function print() {
    if (!ready || !printer || !profile) return;
    const generator = upload
      ? { id: "passthrough", params: { uploadId, filename: file?.name ?? "" } }
      : { id: tab, params };
    if (await job.run({ generator, printerId, profileId }, retryOf, jobLabel, printer.name))
      handoff = null;
  }
</script>

<svelte:head><title>What are we making? · Conveyor</title></svelte:head>

{#if !cat}<Skeleton kind="make" count={5} label="Loading Make" />
{:else if !cat.parts}<MakeDown bind:parts={cat.parts} />
{:else}
{@const { MakeWhere, PrintDock, SchemaForm, UploadDrop } = cat.parts}
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
                {file} {uploading} ready={!!uploadId} bed={profile?.volume} printer={printer?.name}
                error={uploadError} why={uploadWhy} on:file={choose} on:clear={clear}
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
      {:else if !down}
        <p class="note">
          Can't reach Conveyor right now. Check that it's running, then reload the page.
        </p>
      {/if}
      <MakeWhere {down} {eligible} {compatible} all={printers.length} bind:printerId bind:profileId />
    </div>
    <PrintDock {summary} {detail} {ready} none={!printers.length && !down} {...$job} />
  </form>
</section>
{/if}

<style>
  .make {
    display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: var(--s6); align-items: start;
  }
  .order { min-width: 0; }
  .fields { display: flex; flex-direction: column; gap: var(--s5); }
  h1 { margin: 0; font-size: var(--fs-title); line-height: 1; letter-spacing: -0.04em; }
  h2 { margin: 0 0 var(--s2-5); font-size: var(--fs-section); }
  .questions { display: flex; flex-direction: column; gap: var(--s5); }
  .note { margin: 0; color: var(--muted); }
  @media (min-width: 1200px) {
    .make { grid-template-columns: minmax(0, 1fr) minmax(0, 1.45fr); }
    .fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--s5); }
    .fields > :global(*) { grid-column: 1 / -1; }
    .fields > .questions { grid-column: 1; }
    .fields > :global(.where) { grid-column: 2; grid-row: 3; }
  }
  @media (max-width: 759px) {
    .make { grid-template-columns: minmax(0, 1fr); gap: var(--s4); }
    .order { padding-bottom: calc(var(--dock-h, calc(var(--s5) * 5)) + var(--s4)); }
  }
</style>
