<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import type { JobView } from "@conveyor/shared";
  import {
    fetchActiveJobs,
    fetchCatalogPrinters,
    fetchCatalogTransports,
    fetchGenerators,
    fetchPrinterReachable,
    type CatalogPrinter,
    type CatalogTransport,
    type GeneratorSummary,
    type PrinterReachable,
  } from "#lib/api.js";
  import { POLL_MS } from "#lib/belt.js";
  import PrinterCard from "#lib/components/PrinterCard.svelte";
  import PrinterDialog from "#lib/components/PrinterDialog.svelte";
  import { limitsText, printerCard, printersSummary, REACH_MS } from "#lib/printer-status.js";
  import Menu from "#lib/ui/Menu.svelte";

  let printers: CatalogPrinter[] = [];
  let transports: CatalogTransport[] = [];
  let generators: GeneratorSummary[] = [];
  let active: JobView[] = [];
  let reach: Record<string, PrinterReachable> = {};
  let loaded = false;
  let failed = false;
  let now = Date.now();
  let open = false;
  let editing: CatalogPrinter | null = null;

  $: catalog = { printers, generators };
  $: cards = printers.map((printer) => ({ printer, card: printerCard(printer, reach[printer.id], active, catalog, now) }));
  $: transportName = (id: string) => transports.find((t) => t.id === id)?.name ?? id;
  $: editingCard = editing ? cards.find((c) => c.printer.id === editing?.id)?.card : undefined;
  $: editingJobs = editingCard ? editingCard.waiting.length + (editingCard.job ? 1 : 0) : 0;

  async function load() {
    try {
      [printers, transports, generators] = await Promise.all([fetchCatalogPrinters(), fetchCatalogTransports(), fetchGenerators()]);
      failed = false;
    } catch {
      failed = true;
    } finally {
      loaded = true;
    }
  }

  async function poll() {
    if (document.visibilityState !== "visible") return;
    active = await fetchActiveJobs().catch(() => active);
    now = Date.now();
  }

  async function probe() {
    if (document.visibilityState !== "visible") return;
    await Promise.all(
      printers.map(async ({ id }) => {
        const result = await fetchPrinterReachable(id).catch(() => ({ reachable: false, host: "", port: 0, reason: "" }));
        reach = { ...reach, [id]: result };
      }),
    );
    printers = await fetchCatalogPrinters().catch(() => printers);
    now = Date.now();
  }

  async function refresh() {
    await load();
    await Promise.all([poll(), probe()]);
  }

  function add() {
    editing = null;
    open = true;
  }

  function edit(printer: CatalogPrinter) {
    editing = printer;
    open = true;
  }

  onMount(() => {
    void refresh();
    const timers = [setInterval(poll, POLL_MS), setInterval(probe, REACH_MS)];
    return () => timers.forEach(clearInterval);
  });
</script>

<svelte:head><title>Printers · Conveyor</title></svelte:head>

<div class="head">
  <div class="t">
    <h1>Printers</h1>
    {#if loaded && !failed && printers.length}<p class="sub">{printersSummary(printers, active)}</p>{/if}
  </div>
  <div class="acts">
    <button class="btn primary big" type="button" on:click={add} disabled={!loaded || failed}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Add printer
    </button>
    <Menu label="More" items={[{ label: "Check printers again", run: () => void probe() }, { label: "Settings", run: () => goto("/settings") }]} />
  </div>
</div>

{#if !loaded}
  <p class="sub">Loading printers…</p>
{:else if failed}
  <div class="empty" role="alert">
    <h2>Can't reach Conveyor</h2>
    <p class="sub">The printer list didn't load. Check that Conveyor is running, then try again.</p>
    <div><button class="btn big" type="button" on:click={refresh}>Try again</button></div>
  </div>
{:else if !printers.length}
  <div class="empty">
    <h2>No printers yet</h2>
    <p class="sub">Add one and Make can send it jobs.</p>
  </div>
{:else}
  <ul class="grid" aria-label="Printers">
    {#each cards as { printer, card } (printer.id)}
      <PrinterCard {printer} {card} how="{transportName(printer.transportId)} · {printer.address}" limits={limitsText(printer, generators)} edit={() => edit(printer)} />
    {/each}
  </ul>
{/if}

<PrinterDialog bind:open printer={editing} {transports} {generators} taken={printers.map((p) => p.id)} jobs={editingJobs} changed={refresh} />

<style>
  .head { display: flex; align-items: flex-end; gap: var(--s4); flex-wrap: wrap; margin: var(--s2) 0 var(--s5); }
  .t { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: var(--s1); }
  h1 { margin: 0; line-height: 1.05; }
  h2, p { margin: 0; }
  .sub { color: var(--muted); }
  .acts { display: flex; gap: var(--s2); flex-wrap: wrap; }
  .acts :global(.btn), .big { min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body); border-color: var(--field-line); }
  .acts .primary { border-color: var(--accent); }
  .big svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--s4); margin: 0; padding: 0; list-style: none; }
  .empty { max-width: 520px; display: flex; flex-direction: column; gap: var(--s3); padding: 6vh 0; }
  @media (max-width: 759px) {
    .grid { grid-template-columns: 1fr; }
    .acts { width: 100%; }
    .acts .primary { flex: 1; }
  }
</style>
