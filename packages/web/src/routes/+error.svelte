<script lang="ts">
  import { page } from "$app/state";

  const missing = () => page.status === 404;
  const heading = () => (missing() ? "Page not found" : "Something went wrong");
</script>

<svelte:head><title>{heading()} · Conveyor</title></svelte:head>

<section class="error" aria-labelledby="error-title">
  <span class="code">{missing() ? "404" : `Error ${page.status}`}</span>
  <h1 id="error-title">{heading()}</h1>
  {#if missing()}
    <p>There's nothing at <code>{page.url.pathname}</code>. It may have moved, or the link is mistyped.</p>
    <div class="acts">
      <a class="btn primary" href="/">Go to Make</a>
      <a class="btn" href="/jobs">See your jobs</a>
    </div>
  {:else}
    <p>Conveyor couldn't load this page. Try again; if it keeps happening, check that Conveyor is running.</p>
    <div class="acts">
      <button class="btn primary" type="button" on:click={() => location.reload()}>Try again</button>
      <a class="btn" href="/">Go to Make</a>
    </div>
  {/if}
</section>

<style>
  .error { display: flex; flex-direction: column; gap: var(--s4); max-width: 520px; padding: 12vh 0 var(--s6); }
  .code { font: 500 12px var(--mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--faint); }
  h1 { margin: 0; font-size: 40px; }
  p { margin: 0; color: var(--muted); }
  code { font: 500 14px var(--mono); color: var(--ink); background: var(--sunk); padding: 2px 6px; border-radius: 6px; }
  .acts { display: flex; gap: var(--s2); flex-wrap: wrap; }
  .acts .btn { min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body); text-decoration: none; }
  @media (max-width: 759px) { h1 { font-size: 32px; } }
</style>
