<script lang="ts">
  import { onMount } from "svelte";
  import { announce } from "#lib/announce.js";
  import type ViewportCanvas from "./ViewportCanvas.svelte";
  import { hasWebGL, loadViewportCanvas, NO_WEBGL } from "./viewport-canvas.js";

  export let params: Record<string, unknown> = {};
  export let file: File | null = null;

  let canvas: typeof ViewportCanvas | null = null;
  let failed = false;
  let blocked = false;

  onMount(() => {
    blocked = !hasWebGL();
    if (blocked) return;
    loadViewportCanvas().then(
      (module) => (canvas = module.default),
      () => {
        failed = true;
        void announce("The 3D preview didn't load. Reload the page to try again.");
      },
    );
  });
</script>

{#if canvas}
  <svelte:component this={canvas} {params} {file} />
{:else}
  <div class="placeholder">
    <span class="cube" class:still={blocked} aria-hidden="true"></span>
    <span class="note">{blocked ? NO_WEBGL : failed ? "The 3D preview didn't load. Reload the page to try again." : "Loading the 3D preview…"}</span>
  </div>
{/if}

<style>
  .placeholder { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: var(--s4); padding: var(--s4); text-align: center; }
  .cube { width: 44px; height: 44px; border: 2px solid var(--belt-ink); border-radius: var(--r-inner); transform: rotate(45deg) scaleY(0.82); animation: breathe var(--t-breathe) var(--ease-move) infinite alternate; }
  .note { padding: var(--s1) var(--s3); border: 1px solid var(--line); border-radius: var(--r-pill); background: var(--paper); color: var(--ink); font-size: var(--fs-chip); }
  @keyframes breathe { to { opacity: 0.35; } }
  .still { animation: none; }
  @media (prefers-reduced-motion: reduce) { .cube { animation: none; } }
</style>
