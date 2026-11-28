<script lang="ts">
  import { loadMakeParts, MAKE_DOWN, type MakeParts } from "#lib/make-parts.js";

  export let parts: MakeParts | null;
  let busy = false;

  async function again() {
    if (busy) return;
    busy = true;
    const loaded = await loadMakeParts();
    busy = false;
    parts = loaded;
  }
</script>

<section aria-labelledby="make-title">
  <h1 id="make-title">What are we making?</h1>
  <p role="alert">{MAKE_DOWN}</p>
  <button class="btn primary" type="button" aria-busy={busy} on:click={again}>
    {busy ? "Loading…" : "Try again"}
  </button>
</section>

<style>
  section { display: flex; flex-direction: column; align-items: start; gap: var(--s4); }
  h1 { margin: 0; font-size: var(--fs-title); line-height: 1; letter-spacing: -0.04em; }
  p { margin: 0; color: var(--muted); }
</style>
