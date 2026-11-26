<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { announce } from "#lib/announce.js";
  import type { Down } from "#lib/auth-gate.js";
  import { OFFLINE } from "#lib/track.js";
  import { invalidateAll } from "$app/navigation";
  import ErrorDetails from "./ErrorDetails.svelte";

  export let down: Down;

  let [busy, live] = [false, true];

  onMount(() => void announce(`${OFFLINE}. ${down.hint}`, "assertive"));
  onDestroy(() => {
    live = false;
  });

  async function retry() {
    if (busy) return;
    busy = true;
    await invalidateAll();
    await tick();
    busy = false;
    if (live) void announce(`Still can't reach Conveyor. ${down.hint}`, "assertive");
  }
</script>

<svelte:head><title>{OFFLINE} · Conveyor</title></svelte:head>
<svelte:window on:online={retry} />

<section class="down" aria-labelledby="down-title">
  <h1 id="down-title">{OFFLINE}</h1>
  <p>{down.hint} You'll see the sign-in screen or your work once it answers.</p>
  <ErrorDetails detail={down.detail} />
  <button class="btn primary" type="button" disabled={busy} on:click={retry}>{busy ? "Trying again…" : "Try again"}</button>
</section>

<style>
  .down { display: flex; flex-direction: column; align-items: flex-start; gap: var(--s4); max-width: 520px; padding: 12vh 0 var(--s6); }
  h1 { margin: 0; font-size: var(--fs-title); }
  p { margin: 0; color: var(--muted); }
  .down :global(.why) { align-self: stretch; margin: 0; }
  .btn { min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body); }
</style>
