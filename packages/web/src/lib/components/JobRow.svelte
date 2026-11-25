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
    {#if row.printer}<span class="pr"><span class="sr">, on </span>{row.printer}</span>{/if}
    <span class="st"><span class="sr">, </span>{row.status}</span>
    <span class="tm"><span class="sr">, </span>{row.time}</span>
  </a>
</li>

<style>
  .row { position: relative; display: grid; grid-template-columns: 28px minmax(0, 1fr) 150px 170px 130px; gap: 14px; align-items: center; min-height: 56px; padding: 8px 16px; border-top: 1px solid var(--line); color: var(--ink); text-decoration: none; }
  li:first-child .row { border-top: 0; }
  @media (hover: hover) { .row:hover { background: var(--sunk); } }
  .row.sel { background: var(--sunk); box-shadow: inset 3px 0 0 var(--focus); }
  .row:focus-visible { outline-offset: -3px; }
  .name { display: flex; flex-direction: column; min-width: 0; }
  b { overflow: hidden; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
  .why { color: var(--err); font: 500 12.5px var(--mono); }
  .note {
    overflow: hidden; color: var(--muted); font-size: 12.5px;
    text-overflow: ellipsis; white-space: nowrap;
  }
  .pr, .st, .tm { font: 500 12.5px var(--mono); color: var(--muted); }
  .tm { white-space: nowrap; }
  .g { --ring: var(--live); position: relative; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: conic-gradient(var(--ring) calc(var(--p) * 1turn), var(--line-2) 0); color: var(--paper); font: 800 12px / 1 var(--display); }
  .g::before { content: ""; position: absolute; inset: 3px; border-radius: 50%; background: var(--paper); }
  .s-done .g, .s-failed .g { background: var(--ring); }
  .s-done .g::before, .s-failed .g::before { display: none; }
  .s-done .g { --ring: var(--ok); }
  .s-failed .g { --ring: var(--err); }
  .s-canceled .g { --ring: var(--off); }
  .s-canceled b { color: var(--muted); text-decoration: line-through; }
  .s-queued .g { background: none; border: 2px dashed var(--muted); }
  .s-queued .g::before { display: none; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  @media (max-width: 759px) {
    .row { grid-template-columns: 24px minmax(0, 1fr) auto; gap: 4px 10px; padding: 8px 12px; }
    .pr, .tm { display: none; }
    .st { font-size: 12px; text-align: right; }
  }
</style>
