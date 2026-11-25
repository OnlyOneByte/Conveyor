<script lang="ts">
  import Button from "#lib/ui/Button.svelte";
  import { measured } from "#lib/ui/behaviour.js";
  import ErrorDetails from "./ErrorDetails.svelte";
  import Notice from "./Notice.svelte";
  export let summary: string;
  export let detail: string;
  export let ready: boolean;
  export let busy: boolean;
  export let sent: boolean;
  export let last: { id: string; printer: string } | null;
  export let error: string | null = null;
  export let retried: string | null = null;
  export let why: string | null = null;
</script>

<div class="dock" use:measured={"dock-h"}>
  {#if error}
    <div class="say">
      <Notice tone="err" title="Your print didn't go out">
        <span>
          {error}
          {#if retried}<a href="/jobs/{encodeURIComponent(retried)}">See the retry</a>{/if}
        </span>
        <ErrorDetails detail={why} />
        <svelte:fragment slot="action">
          {#if !retried}<Button type="submit" disabled={!ready}>Try again</Button>{/if}
        </svelte:fragment>
      </Notice>
    </div>
  {:else if last}
    <p class="last" role="status">
      Sent to {last.printer} · <a href="/jobs/{encodeURIComponent(last.id)}">See the job</a>
    </p>
  {/if}
  <div class="bar">
    <p class="sum">
      <b>{summary}</b>
      <span class="line">
        <span class="detail">{detail}</span> · <a href="#make-where" class="change">Change</a>
      </span>
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
    border-radius: var(--r-panel); background: var(--ink); color: var(--bg); --focus: var(--bg);
  }
  .sum { flex: 1; min-width: 0; margin: 0; }
  b { display: block; font-size: var(--fs-section); }
  .line {
    display: flex; gap: 0.6ch; min-width: 0; font: 500 var(--fs-mono) var(--mono);
    color: color-mix(in oklch, var(--bg) 85%, var(--ink));
  }
  .detail { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .change { flex: none; }
  .last { margin: 0 0 var(--s2); font-weight: 600; }
  .say { margin: 0 0 var(--s2); }
  .say a { color: var(--ink); text-decoration: underline; text-underline-offset: 2px; }
  .last a, .change { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
  @media (pointer: coarse) {
    .last a, .change { position: relative; }
    .last a::after, .change::after {
      content: ""; position: absolute; inset: calc(50% - var(--tap) / 2) 0;
      min-width: var(--tap);
    }
  }
  .print {
    min-height: 54px; padding: 0 26px; border: 0; border-radius: var(--r-chip);
    background: var(--accent); color: var(--accent-ink); font-size: var(--fs-section); font-weight: 800;
  }
  @media (hover: hover) { .print:hover:not(:disabled) { box-shadow: 0 0 0 3px var(--bg); } }
  .print:focus-visible { outline: 3px solid var(--bg); outline-offset: 3px; }
  .print:disabled {
    opacity: 1; background: color-mix(in oklch, var(--bg) 25%, var(--ink)); color: var(--bg);
  }
  @media (max-width: 759px) {
    .dock {
      position: fixed; left: 0; right: 0; bottom: var(--tabbar, 0px); padding: 18px 10px 8px;
    }
    .bar { padding: 10px 10px 10px 16px; }
    b { font-size: var(--fs-body); }
    .line { flex-wrap: wrap; }
    .detail { white-space: normal; }
    .print { min-height: 50px; padding: 0 20px; }
  }
</style>
