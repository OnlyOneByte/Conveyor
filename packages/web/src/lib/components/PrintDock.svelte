<script lang="ts">
  export let summary: string;
  export let detail: string;
  export let ready: boolean;
  export let busy: boolean;
  export let sent: boolean;
  export let last: { id: string; printer: string } | null;
</script>

<div class="dock">
  {#if last}
    <p class="last" role="status">
      Sent to {last.printer} · <a href="/jobs/{encodeURIComponent(last.id)}">See the job</a>
    </p>
  {/if}
  <div class="bar">
    <p class="sum">
      <b>{summary}</b><span>{detail} · <a href="#make-where" class="change">Change</a></span>
    </p>
    <button type="submit" class="print" disabled={!ready} aria-disabled={busy}>
      {sent ? "Sent ✓" : busy ? "Sending…" : "Print"}
    </button>
  </div>
</div>

<style>
  .dock {
    position: sticky; bottom: 0; z-index: 4; padding: var(--s3) 0 var(--s4); background: var(--bg);
  }
  .bar {
    display: flex; align-items: center; gap: var(--s4); padding: 14px 14px 14px 22px;
    border-radius: 22px; background: var(--ink); color: var(--bg);
  }
  .sum { flex: 1; min-width: 0; margin: 0; }
  b { display: block; font-size: 17px; }
  span {
    display: block; font: 500 12.5px var(--mono); opacity: 0.85;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .last { margin: 0 0 var(--s2); font-weight: 600; }
  .last a, .change { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
  .print {
    min-height: 54px; padding: 0 26px; border: 0; border-radius: 17px;
    background: var(--accent); color: var(--accent-ink); font-size: 18px; font-weight: 800;
  }
  .print:focus-visible { outline: 3px solid var(--bg); outline-offset: 3px; }
  .print:disabled {
    opacity: 1; background: color-mix(in oklch, var(--bg) 25%, var(--ink)); color: var(--bg);
  }
  @media (max-width: 759px) {
    .dock {
      position: fixed; left: 0; right: 0; bottom: var(--tabbar, 0px); padding: 18px 10px 8px;
    }
    .bar { padding: 10px 10px 10px 16px; }
    b { font-size: 15px; }
    span { white-space: normal; }
    .print { min-height: 50px; padding: 0 20px; }
  }
</style>
