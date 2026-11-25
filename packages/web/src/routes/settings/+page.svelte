<script lang="ts">
  import { onMount } from "svelte";
  import { version } from "$app/env";
  import {
    type CatalogProfile,
    type CatalogSlicer,
    fetchCatalogProfiles,
    fetchCatalogSlicers,
    fetchCatalogTransports,
  } from "#lib/api.js";
  import ProfileList from "#lib/components/ProfileList.svelte";
  import ThemePicker from "#lib/components/ThemePicker.svelte";
  import { prefersReducedMotion, singleKeyShortcuts, spinPreview } from "#lib/preferences.js";
  import Switch from "#lib/ui/Switch.svelte";

  const REPO = "https://github.com/OnlyOneByte/Conveyor";
  const links = [
    { href: REPO, label: "Source code" },
    { href: `${REPO}/tree/main/docs`, label: "Documentation" },
    { href: `${REPO}/issues/new`, label: "Report a problem" },
    { href: `${REPO}/blob/main/LICENSE`, label: "AGPL-3.0 license" },
  ];
  const release = /^v?\d+\.\d+\.\d+/.test(version)
    ? version.replace(/^v/, "")
    : "Development build";
  const still = prefersReducedMotion();

  let profiles: CatalogProfile[] = [];
  let slicers: CatalogSlicer[] = [];
  let flavors: string[] = [];
  let [loaded, failed] = [false, false];

  async function load() {
    try {
      const [listed, known, transports] = await Promise.all([
        fetchCatalogProfiles(),
        fetchCatalogSlicers(),
        fetchCatalogTransports(),
      ]);
      [profiles, slicers] = [listed, known];
      flavors = [...new Set(transports.flatMap((t) => t.acceptsFlavors))];
      failed = false;
    } catch {
      failed = true;
    } finally {
      loaded = true;
    }
  }

  onMount(load);
</script>

<svelte:head><title>Settings · Conveyor</title></svelte:head>

<div class="head">
  <h1>Settings</h1>
  <p class="sub">Profiles, this browser and about Conveyor.</p>
</div>

<div class="cols">
  {#if !loaded}
    <p class="sub">Loading profiles…</p>
  {:else if failed}
    <div class="panel" role="alert">
      <h2>Can't reach Conveyor</h2>
      <p class="sub">The profiles didn't load. Check that Conveyor is running, then try again.</p>
      <div><button class="btn big" type="button" on:click={load}>Try again</button></div>
    </div>
  {:else}
    <ProfileList {profiles} {slicers} {flavors} changed={load} />
  {/if}

  <div class="side">
    <section class="panel" aria-labelledby="browser-h">
      <div class="t">
        <h2 id="browser-h">This browser</h2>
        <p class="sub">Saved on this device only.</p>
      </div>
      <ThemePicker />
      <div class="pref">
        <Switch label="Spin the 3D preview" bind:checked={$spinPreview} />
        {#if still}
          <p class="hint">Your system asks for less motion, so the preview stays still.</p>
        {/if}
      </div>
      <div class="pref">
        <Switch label="Single-key shortcuts" bind:checked={$singleKeyShortcuts} />
        <p class="hint">Keys like N, and G then M. Ctrl K and the arrow keys always work.</p>
      </div>
    </section>

    <section class="panel" aria-labelledby="about-h">
      <h2 id="about-h">About</h2>
      <dl>
        <dt>Version</dt><dd>{release}</dd>
        <dt>Sign-in</dt><dd>Set by <code>CONVEYOR_PASSWORD</code> when Conveyor starts</dd>
      </dl>
      <ul class="links">
        {#each links as link (link.href)}
          <li><a href={link.href} rel="noreferrer">{link.label}</a></li>
        {/each}
      </ul>
    </section>
  </div>
</div>

<style>
  .head { display: flex; flex-direction: column; gap: var(--s1); margin: var(--s2) 0 var(--s5); }
  h1, h2, p { margin: 0; }
  h1 { line-height: 1.05; }
  .sub, .hint, dt { color: var(--muted); }
  .hint { font-size: var(--fs-chip); }
  .cols {
    display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(300px, 1fr); gap: var(--s5);
    align-items: start;
  }
  .side { display: flex; flex-direction: column; gap: var(--s5); }
  .panel {
    display: flex; flex-direction: column; gap: var(--s4); padding: var(--s5);
    border-radius: var(--r-card); background: var(--paper); border: 1px solid var(--line);
    box-shadow: var(--lift);
  }
  .t, .pref { display: flex; flex-direction: column; gap: 2px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: var(--s1) var(--s4); margin: 0; }
  dd { margin: 0; font-weight: 600; }
  code { font: 500 var(--fs-chip) var(--mono); }
  .links {
    display: flex; flex-wrap: wrap; gap: var(--s2) var(--s4); margin: 0; padding: 0;
    list-style: none;
  }
  .links a {
    display: inline-flex; align-items: center; min-height: 30px; color: var(--ink);
    font-weight: 600;
  }
  .big { min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body); }
  @media (pointer: coarse) { .links a { min-height: var(--tap); } }
  @media (max-width: 999px) { .cols { grid-template-columns: 1fr; } }
  @media (max-width: 759px) { .panel { padding: var(--s4); } }
</style>
