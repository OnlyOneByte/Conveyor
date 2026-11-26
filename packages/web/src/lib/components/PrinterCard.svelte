<script lang="ts">
  import type { CatalogPrinter } from "#lib/api.js";
  import { secretFieldFor } from "#lib/printer-secrets.js";
  import type { PrinterCard } from "#lib/printer-status.js";

  export let printer: CatalogPrinter;
  export let card: PrinterCard;
  export let how: string;
  export let limits: string;
  export let edit: () => void;

  $: stuck = card.tone === "offline" && card.waiting.length > 0;
  $: waitTitle = !card.waiting.length
    ? "Nothing waiting"
    : stuck
      ? `${card.waiting.length} waiting · can't start until it's back`
      : `${card.waiting.length} waiting`;
</script>

<li class="card {card.tone}" aria-labelledby="printer-{printer.id}">
  <header>
    <div class="t">
      <h2 id="printer-{printer.id}">{printer.name}</h2>
      <p class="how">{how}</p>
    </div>
    <span class="pill {card.tone}">{card.status}</span>
  </header>
  {#if card.job}
    <div class="now">
      <a href="/jobs/{card.job.id}">{card.job.name}</a>
      <span>{card.job.line}</span>
    </div>
    {#if card.job.progress !== undefined}
      {@const pct = Math.round(card.job.progress * 100)}
      <div class="bar" role="progressbar" aria-label="{printer.name} print progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <i style="width: {pct}%"></i>
      </div>
    {/if}
  {:else}
    <p class="now">{card.detail}</p>
  {/if}
  <div class="wait" class:stuck>
    <h3 class="label">{waitTitle}</h3>
    {#if card.waiting.length}
      <ol>
        {#each card.waiting as job (job.id)}<li><a href="/jobs/{job.id}">{job.name}</a></li>{/each}
      </ol>
    {/if}
  </div>
  <div class="foot">
    <span>{printer.hasSecrets ? `${limits} · ${secretFieldFor(printer.transportId).label} saved` : limits}</span>
    <button class="btn" type="button" aria-label="Edit {printer.name}" on:click={edit}>Edit</button>
  </div>
</li>

<style>
  .card { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s4) var(--s5) var(--s5); }
  .card.offline { border: 1.5px solid var(--err); }
  header { display: flex; align-items: flex-start; gap: var(--s3); }
  .t { flex: 1; min-width: 0; }
  h2 { margin: 0; font-size: var(--fs-section); font-weight: 800; letter-spacing: -0.02em; overflow-wrap: anywhere; }
  p, h3 { margin: 0; }
  .how { font: 500 var(--fs-chip) var(--mono); color: var(--muted); overflow-wrap: anywhere; }
  .pill { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 10px; border: 1.5px solid currentColor; border-radius: var(--r-pill); font-weight: 700; font-size: var(--fs-chip); white-space: nowrap; }
  .pill::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
  .pill.ready { color: var(--ok); }
  .pill.busy {
    border-color: color-mix(in oklch, var(--live) 80%, var(--paper));
    background: color-mix(in oklch, var(--live) 14%, var(--paper)); color: var(--ink);
  }
  .pill.busy::before { background: var(--live); }
  .pill.offline { color: var(--err); }
  .pill.offline::before {
    box-sizing: border-box; border: 1.5px solid currentColor;
    background: linear-gradient(45deg, transparent 42%, currentColor 42% 58%, transparent 58%);
  }
  .pill.checking { color: var(--muted); }
  .pill.checking::before { box-sizing: border-box; background: none; border: 1.5px solid currentColor; }
  .now { display: flex; flex-direction: column; gap: 2px; color: var(--muted); }
  .now a { color: var(--ink); font-weight: 700; }
  .bar { height: 8px; border: 1px solid var(--field-line); border-radius: var(--r-pill); background: var(--sunk); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--live); }
  .wait { display: flex; flex-direction: column; gap: var(--s1); padding-top: var(--s3); border-top: 1.5px dashed var(--line-2); }
  .stuck h3 { color: var(--err); }
  ol { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
  ol a { display: inline-flex; align-items: center; min-height: 24px; }
  .now a { align-self: flex-start; display: inline-flex; align-items: center; min-height: 24px; }
  @media (pointer: coarse) { ol a, .now a { min-height: var(--tap); } }
  .foot { display: flex; align-items: center; gap: var(--s2); margin-top: auto; color: var(--muted); font-size: var(--fs-chip); }
  .foot span { flex: 1; }
  .foot .btn { min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body); border-color: var(--field-line); }
</style>
