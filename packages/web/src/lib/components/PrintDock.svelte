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
  export let attempt = 0;
  export let none = false;

  let say: HTMLElement | null = null;
  let print: HTMLButtonElement | null = null;

  $: if (!error || retried) handOff();

  function handOff() {
    if (say?.contains(document.activeElement)) print?.focus();
  }
</script>

<div class="dock" use:measured={"dock-h"}>
  {#if error}
    <div class="say" bind:this={say}>
      <Notice tone="err" title="Your print didn't go out" role="alert" stamp={attempt}>
        <span slot="message">
          {error}
          {#if retried}<a href="/jobs/{encodeURIComponent(retried)}">See the retry</a>{/if}
        </span>
        <ErrorDetails detail={why} />
        <svelte:fragment slot="action">
          {#if !retried}<Button type="submit" disabled={!ready}>{busy ? "Sending…" : "Try again"}</Button>{/if}
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
      <b title={summary}>{summary}</b>
      <span class="line">
        <span class="detail">{detail}</span>{#if !none} · <a href="#make-where" class="change">Change</a>{/if}
      </span>
    </p>
    {#if none}<a class="print" href="/printers?add">Add printer</a>
    {:else}<button type="submit" class="print" bind:this={print} disabled={!ready} aria-disabled={busy}>
      {sent ? "Sent ✓" : busy ? "Sending…" : "Print"}
    </button>{/if}
  </div>
</div>

<style>
  .dock {
    position: sticky; bottom: 0; z-index: 4; padding: var(--s3) 0 var(--s4); background: var(--bg);
  }
  .bar {
    display: flex; align-items: center; gap: var(--s4); padding: var(--s3-5) var(--s3-5) var(--s3-5) var(--s5);
    --dock-bg: var(--ink); --dock-ink: var(--bg);
    border-radius: var(--r-panel); background: var(--dock-bg); color: var(--dock-ink);
    --focus: var(--dock-ink);
  }
  :global([data-theme="dark"]) .bar {
    --dock-bg: var(--raised); --dock-ink: var(--ink); box-shadow: 0 0 0 1px var(--line-2), var(--lift-hi);
  }
  .sum { flex: 1; min-width: 0; margin: 0; }
  b {
    display: -webkit-box; overflow: hidden; font-size: var(--fs-section); overflow-wrap: anywhere;
    -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2;
  }
  .line {
    display: flex; gap: 0.6ch; min-width: 0; font: 500 var(--fs-mono) var(--mono);
    color: color-mix(in oklch, var(--dock-ink) 85%, var(--dock-bg));
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
    min-height: 54px; padding: 0 var(--s5); border: 0; border-radius: var(--r-chip);
    background: var(--accent); color: var(--accent-ink); font-size: var(--fs-section); font-weight: 800;
  }
  a.print { display: inline-flex; align-items: center; flex: none; text-decoration: none; }
  @media (hover: hover) { .print:hover:not(:disabled) { box-shadow: 0 0 0 3px var(--dock-ink); } }
  .print:focus-visible { outline: 3px solid var(--dock-ink); outline-offset: 3px; }
  .print:disabled {
    opacity: 1; background: color-mix(in oklch, var(--dock-ink) 25%, var(--dock-bg));
    color: var(--dock-ink);
  }
  @media (max-width: 759px) {
    .dock {
      position: fixed; left: 0; right: 0; bottom: var(--tabbar, 0px); padding: var(--s4) var(--s2-5) var(--s2);
    }
    .bar { padding: var(--s2-5) var(--s2-5) var(--s2-5) var(--s4); }
    b { font-size: var(--fs-body); }
    .line { flex-wrap: wrap; }
    .detail { white-space: normal; }
    .print { min-height: 50px; padding: 0 var(--s5); }
  }
</style>
