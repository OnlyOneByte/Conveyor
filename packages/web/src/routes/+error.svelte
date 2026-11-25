<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { OFFLINE } from "#lib/track.js";

  let unreachable = false;
  const missing = () => page.status === 404;
  const heading = () => (missing() ? "Page not found" : unreachable ? OFFLINE : "Something went wrong");

  onMount(() => {
    if (missing()) return;
    fetch("/_app/version.json", { cache: "no-store" }).catch(() => (unreachable = true));
  });
</script>

<svelte:head><title>{heading()} · Conveyor</title></svelte:head>

<section class="error" aria-labelledby="error-title">
  <span class="code label">{missing() ? "404" : unreachable ? "Offline" : `Error ${page.status}`}</span>
  <h1 id="error-title">{heading()}</h1>
  {#if missing()}
    <p>There's nothing at <code>{page.url.pathname}</code>. It may have moved, or the link is mistyped.</p>
    <div class="acts">
      <a class="btn primary" href="/">Go to Make</a>
      <a class="btn" href="/jobs">See your jobs</a>
    </div>
  {:else}
    <p>{unreachable ? "This page isn't saved on this device yet. It opens once Conveyor is back." : "Conveyor couldn't load this page. Try again; if it keeps happening, check that Conveyor is running."}</p>
    <div class="acts">
      <button class="btn primary" type="button" on:click={() => location.reload()}>Try again</button>
      <a class="btn" href="/">Go to Make</a>
    </div>
  {/if}
</section>

<style>
  .error { display: flex; flex-direction: column; gap: var(--s4); max-width: 520px; padding: 12vh 0 var(--s6); }
  .code { color: var(--faint); }
  h1 { margin: 0; font-size: var(--fs-title); }
  p { margin: 0; color: var(--muted); }
  code { font: 500 var(--fs-body) var(--mono); color: var(--ink); background: var(--sunk); padding: 2px 6px; border-radius: var(--r-tiny); }
  .acts { display: flex; gap: var(--s2); flex-wrap: wrap; }
  .acts .btn { min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body); text-decoration: none; }
</style>
