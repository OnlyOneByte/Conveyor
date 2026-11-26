<script lang="ts">
  import type { JobView } from "@conveyor/shared";
  import { onMount } from "svelte";
  import {
    type CatalogPrinter,
    type CatalogTransport,
    fetchActiveJobs,
    fetchCatalogPrinters,
    fetchCatalogTransports,
    fetchGenerators,
    fetchPrinterReachable,
    type GeneratorSummary,
    type PrinterReachable,
  } from "#lib/api.js";
  import { POLL_MS } from "#lib/belt.js";
  import FirstPrinter from "#lib/components/FirstPrinter.svelte";
  import PrinterCard from "#lib/components/PrinterCard.svelte";
  import PrinterDialog from "#lib/components/PrinterDialog.svelte";
  import PrintersHead from "#lib/components/PrintersHead.svelte";
  import { limitsText, printerCard, printersSummary, REACH_MS } from "#lib/printer-status.js";
  import Skeleton from "#lib/ui/Skeleton.svelte";

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
  let loading: Promise<void> = Promise.resolve();

  $: catalog = { printers, generators };
  $: cards = printers.map((printer) => ({
    printer,
    card: printerCard(printer, reach[printer.id], active, catalog, now),
  }));
  $: transportName = (id: string) => transports.find((t) => t.id === id)?.name ?? id;
  $: editingCard = editing ? cards.find((c) => c.printer.id === editing?.id)?.card : undefined;
  $: editingJobs = editingCard ? editingCard.waiting.length + (editingCard.job ? 1 : 0) : 0;

  async function load() {
    try {
      [printers, transports, generators] = await Promise.all([
        fetchCatalogPrinters(),
        fetchCatalogTransports(),
        fetchGenerators(),
      ]);
      failed = false;
    } catch {
      failed = true;
    } finally {
      loaded = true;
    }
  }

  const unreachable = () => ({ reachable: false, host: "", port: 0, reason: "" });

  async function poll() {
    if (document.visibilityState !== "visible") return;
    active = await fetchActiveJobs().catch(() => active);
    now = Date.now();
  }

  async function probe() {
    if (document.visibilityState !== "visible") return;
    await Promise.all(
      printers.map(async ({ id }) => {
        const result = await fetchPrinterReachable(id).catch(unreachable);
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

  function edit(printer: CatalogPrinter | null = null) {
    editing = printer;
    open = true;
  }

  async function add() {
    await loading;
    edit();
  }

  onMount(() => {
    loading = refresh();
    const timers = [setInterval(poll, POLL_MS), setInterval(probe, REACH_MS)];
    return () => timers.forEach(clearInterval);
  });
</script>

<svelte:head><title>Printers · Conveyor</title></svelte:head>

<PrintersHead
  summary={loaded && !failed && printers.length ? printersSummary(printers, active) : ""}
  ready={loaded} {failed} {add} check={() => void probe()}
/>

{#if !loaded}
  <Skeleton kind="cards" count={2} label="Loading printers" />
{:else if failed}
  <div class="empty" role="alert">
    <h2>Can't reach Conveyor</h2>
    <p class="sub">The printer list didn't load. Check that Conveyor is running, then try again.</p>
    <div><button class="btn big" type="button" on:click={refresh}>Try again</button></div>
  </div>
{:else if !printers.length}
  <FirstPrinter none onPrinters />
{:else}
  <ul class="grid" aria-label="Printers">
    {#each cards as { printer, card } (printer.id)}
      <PrinterCard {printer} {card} how="{transportName(printer.transportId)} · {printer.address}" limits={limitsText(printer, generators)} edit={() => edit(printer)} changed={load} />
    {/each}
  </ul>
{/if}

<PrinterDialog bind:open printer={editing} {transports} {generators} taken={printers.map((p) => p.id)} jobs={editingJobs} changed={refresh} />

<style>
  h2, p { margin: 0; }
  .sub { color: var(--muted); }
  .big {
    min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body);
    border-color: var(--field-line);
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--s4); margin: 0; padding: 0; list-style: none; }
  .empty { max-width: 520px; display: flex; flex-direction: column; gap: var(--s3); padding: 6vh 0; }
  @media (max-width: 759px) {
    .grid { grid-template-columns: 1fr; }
  }
</style>
