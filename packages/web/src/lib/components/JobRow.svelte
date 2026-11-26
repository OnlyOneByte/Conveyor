<script lang="ts">
  import type { Row } from "#lib/jobs-list.js";

  export let row: Row;
  export let selected = false;
</script>

<li>
  <a class="row s-{row.state}" class:sel={selected} href="/jobs/{row.id}" tabindex={selected ? 0 : -1} data-id={row.id}>
    <span class="g" style="--p: {row.progress}" aria-hidden="true">{row.state === "done" ? "✓" : row.state === "failed" ? "!" : ""}</span>
    <span class="name">
      <b>{row.name}</b>
      {#if row.why}<span class="why"><span class="sr">, </span>{row.why}</span>{/if}
      {#if row.note}<span class="note"><span class="sr">, </span>Note: {row.note}</span>{/if}
    </span>
    {#if row.printer}<span class="pr" title={row.printer}><span class="sr">, on </span>{row.printer}</span>{/if}
    <span class="st"><span class="sr">, </span>{row.status}</span>
    <span class="tm"><span class="sr">, </span>{row.time}</span>
  </a>
</li>

<style>
  .row {
    position: relative; display: grid; gap: 0 var(--s3-5); align-content: center; align-items: center;
    grid-template-areas: "g b pr st tm" ". why . . ." ". note . . .";
    grid-template-columns: 28px minmax(0, 1fr) 150px 170px 130px;
    min-height: 56px; padding: var(--s2) var(--s4); border-top: 1px solid var(--line);
    color: var(--ink); text-decoration: none;
  }
  li:first-child .row { border-top: 0; }
  @media (hover: hover) { .row:hover { background: var(--sunk); } }
  .row.sel { background: var(--sunk); box-shadow: inset 3px 0 0 var(--focus); }
  .row:focus-visible { outline-offset: -3px; }
  .name { display: contents; }
  .g { grid-area: g; }
  b {
    grid-area: b; min-width: 0; overflow: hidden; font-weight: 700;
    text-overflow: ellipsis; white-space: nowrap;
  }
  .why {
    grid-area: why; margin-top: calc(var(--s0) / 2); color: var(--ink); font-size: var(--fs-chip);
    line-height: 1.4;
  }
  .note {
    grid-area: note; display: -webkit-box; overflow: hidden; margin-top: calc(var(--s0) / 2);
    color: var(--muted);
    font-size: var(--fs-mono); line-height: 1.4; -webkit-box-orient: vertical;
    -webkit-line-clamp: 2; line-clamp: 2;
  }
  .pr { grid-area: pr; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .st { grid-area: st; }
  .tm { grid-area: tm; }
  .pr, .st, .tm { font: 500 var(--fs-mono) var(--mono); color: var(--muted); }
  .s-failed .st { color: var(--err); }
  .tm { white-space: nowrap; }
  .g { --ring: var(--live); position: relative; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: conic-gradient(var(--ring) calc(var(--p) * 1turn), var(--line-2) 0); color: var(--paper); font: 800 var(--fs-mono) / 1 var(--display); }
  .g::before { content: ""; position: absolute; inset: 3px; border-radius: 50%; background: var(--paper); }
  .s-done .g, .s-failed .g { background: var(--ring); }
  .s-done .g::before, .s-failed .g::before { display: none; }
  .s-done .g { --ring: var(--ok); }
  .s-failed .g { --ring: var(--err); }
  .s-canceled .g { --ring: var(--off); }
  .s-canceled b { color: var(--muted); text-decoration: line-through; }
  .s-queued .g { background: none; border: 2px dashed var(--muted); }
  .s-queued .g::before { display: none; }
  @media (max-width: 759px) {
    .row {
      grid-template-areas: "g b st" ". why why" ". note note";
      grid-template-columns: 24px minmax(0, 1fr) auto;
      gap: 0 var(--s2-5); padding: var(--s2-5) var(--s3);
    }
    .pr, .tm { display: none; }
    .st { text-align: right; }
  }
</style>
