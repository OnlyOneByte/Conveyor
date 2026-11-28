<script lang="ts">
  import type { JobView } from "@conveyor/shared";
  import { onMount, tick } from "svelte";
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
  import PrintersHead from "#lib/components/PrintersHead.svelte";
  import StateCard from "#lib/components/StateCard.svelte";
  import { loadPrinterDialog } from "#lib/printer-dialog.js";
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
  let [head, first]: (HTMLButtonElement | null)[] = [null, null];
  let Dialog: Awaited<ReturnType<typeof loadPrinterDialog>> = null;

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
    await refocus();
  }

  async function refocus() {
    await tick();
    if (document.activeElement === document.body) (head ?? first)?.focus();
  }

  async function edit(printer: CatalogPrinter | null = null) {
    editing = printer;
    Dialog ??= await loadPrinterDialog();
    open = Dialog !== null;
  }

  async function add() {
    await loading;
    if (!failed) await edit();
  }

  onMount(() => {
    loading = load();
    void loading.then(() => Promise.all([poll(), probe()]));
    const timers = [setInterval(poll, POLL_MS), setInterval(probe, REACH_MS)];
    return () => timers.forEach(clearInterval);
  });
</script>

<svelte:head><title>Printers · Conveyor</title></svelte:head>

<PrintersHead
  summary={loaded && !failed && printers.length ? printersSummary(printers, active) : ""}
  ready={loaded} {failed} {add} check={() => void probe()} bind:button={head}
  empty={loaded && !failed && !printers.length} fallback={first}
/>

{#if !loaded}
  <Skeleton kind="cards" count={2} label="Loading printers" />
{:else if failed}
  <StateCard tone="err" level="h2" role="alert" title="Can't reach Conveyor">
    <p>The printer list didn't load. Check that Conveyor is running, then try again.</p>
    <button class="btn primary" type="button" on:click={refresh}>Try again</button>
  </StateCard>
{:else if !printers.length}
  <FirstPrinter none {add} bind:button={first} />
{:else}
  <ul class="grid" aria-label="Printers">
    {#each cards as { printer, card } (printer.id)}
      <PrinterCard {printer} {card} how="{transportName(printer.transportId)} · {printer.address}" limits={limitsText(printer, generators)} edit={() => edit(printer)} changed={load} />
    {/each}
  </ul>
{/if}

{#if Dialog}<svelte:component this={Dialog} bind:open printer={editing} {transports} {generators} taken={printers.map((p) => p.id)} jobs={editingJobs} changed={refresh} settled={refocus} />{/if}

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--s4); margin: 0; padding: 0; list-style: none; }
  @media (max-width: 759px) {
    .grid { grid-template-columns: 1fr; }
  }
</style>
