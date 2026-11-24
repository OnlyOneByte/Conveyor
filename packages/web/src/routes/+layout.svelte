<script lang="ts">
  import "#lib/styles/app.css";
  import { onMount } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { cancelJob, fetchActiveJobs, fetchJobHistoryEntry, fetchJobSnapshot, logout, openJobSocket, signedIn } from "#lib/api.js";
  import { announce, announcements } from "#lib/announce.js";
  import { shareActive } from "#lib/active-jobs.js";
  import { createBelt, createTicker, POLL_MS } from "#lib/belt.js";
  import { createEnds, ENDS_MS, http } from "#lib/belt-ends.js";
  import { loadCatalog } from "#lib/catalog.js";
  import { createNewsDesk } from "#lib/belt-news.js";
  import Keyboard from "#lib/components/Keyboard.svelte";
  import Login from "#lib/components/Login.svelte";
  import Belt from "#lib/components/Belt.svelte";
  import { stashRerun } from "#lib/rerun.js";
  import type { TrackJob } from "#lib/track.js";
  import { toasts } from "#lib/ui/behaviour.js";
  import { resolveTheme, theme } from "#lib/preferences.js";
  import Toasts from "#lib/ui/Toasts.svelte";
  import type { LayoutData } from "./$types";

  export let data: LayoutData;

  const { polite, assertive } = announcements;
  const TABS = [
    { href: "/", label: "Make", icon: "M12 3 4 7.5v9L12 21l8-4.5v-9L12 3ZM4 7.5l8 4.5 8-4.5M12 12v9", on: (p: string) => p === "/" },
    { href: "/history", label: "Jobs", icon: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01", on: (p: string) => p.startsWith("/history") || p.startsWith("/monitor") },
    { href: "/settings", label: "Printers", icon: "M5 3h14v4H5zM3 7h18v10H3zM8 17v4h8v-4", on: (p: string) => p.startsWith("/settings") },
  ];

  $: showApp = signedIn(data.auth);
  const os = matchMedia("(prefers-color-scheme: dark)");
  let osDark = os.matches;
  const syncOs = () => (osDark = os.matches);
  onMount(() => {
    os.addEventListener("change", syncOs);
    return () => os.removeEventListener("change", syncOs);
  });
  $: dark = resolveTheme($theme, osDark) === "dark";

  let beltJobs: TrackJob[] = [], beltEnded: TrackJob[] = [], beltOffline = false;
  let finishedToday: number | undefined, needs: TrackJob[] = [];
  const clock = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const ends = createEnds({ ...http, entry: fetchJobHistoryEntry, cancel: cancelJob, catalog: () => loadCatalog() }, {
    show: (finished, failures) => ((finishedToday = finished), (needs = failures)),
    toast: (text, action) => toasts.show(text, action),
    say: (text, level) => void announce(text, level),
    pick: ({ generator, printerId, profileId }, retryOf) => {
      stashRerun({ generatorId: generator.id, params: generator.params, printerId, profileId, retryOf });
      location.assign("/?rerun=1");
    },
  });
  const refreshEnds = () => showApp && document.visibilityState === "visible" && void ends.refresh();
  const desk = createNewsDesk(announce);
  const belt = createBelt({ active: shareActive(fetchActiveJobs), final: fetchJobSnapshot, socket: openJobSocket, catalog: () => loadCatalog(), clock }, (jobs, ended, offline) => ((beltJobs = jobs), (beltEnded = ended), (beltOffline = offline)), (news) => (desk(news), news.length && refreshEnds()));
  const tick = createTicker(belt, () => showApp && document.visibilityState === "visible");
  onMount(() => {
    tick();
    refreshEnds();
    const timers = [setInterval(tick, POLL_MS), setInterval(refreshEnds, ENDS_MS)];
    document.addEventListener("visibilitychange", tick);
    return () => {
      for (const timer of timers) clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      belt.stop();
    };
  });

  async function signOut() {
    await logout();
    await invalidateAll();
  }
</script>

<a class="skip" href="#main">Skip to content</a>
<div class="shell">
  <header class="top">
    <a href="/" class="word"><span class="bars" aria-hidden="true"><b></b><b></b><b></b></span>Conveyor</a>
    {#if showApp}
      <nav class="tabs" aria-label="Main">
        {#each TABS as tab (tab.href)}
          <a href={tab.href} aria-current={tab.on(page.url.pathname) ? "page" : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={tab.icon} /></svg>{tab.label}
          </a>
        {/each}
      </nav>
    {/if}
    <span class="sp"></span>
    {#if showApp}<Keyboard />{/if}
    <button class="btn ghost icon" type="button" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} on:click={() => theme.set(dark ? "light" : "dark")}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {#if dark}<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />{:else}<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />{/if}
      </svg>
    </button>
    {#if showApp && data.auth.authEnabled}
      <button class="btn ghost" type="button" on:click={signOut}>Sign out</button>
    {/if}
  </header>
  <div class="belt" id="belt">{#if showApp}<Belt jobs={beltJobs} ended={beltEnded} offline={beltOffline} onAction={ends.act} {finishedToday} {needs} />{/if}</div>
  <main id="main" tabindex="-1">
    {#if showApp}
      <slot />
    {:else}
      <Login on:authed={() => invalidateAll()} />
    {/if}
  </main>
  <div class="sr" aria-live="polite">{$polite}</div>
  <div class="sr" aria-live="assertive">{$assertive}</div>
  <Toasts />
</div>

<style>
  .shell { max-width: 90rem; margin: 0 auto; padding: 0 var(--s6) var(--s6); }
  .top { display: flex; align-items: center; gap: var(--s5); min-height: 60px; }
  .word { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 22px; letter-spacing: -0.03em; text-transform: lowercase; text-decoration: none; color: var(--ink); }
  .bars { display: flex; gap: 3px; }
  .bars b { width: 7px; height: 18px; border-radius: 3px; background: var(--accent); transform: skewX(-14deg); }
  .bars b:nth-child(2) { opacity: 0.6; }
  .bars b:nth-child(3) { opacity: 0.3; }
  .tabs { display: flex; gap: var(--s1); padding: var(--s1); border-radius: 15px; background: var(--sunk); border: 1px solid var(--line); }
  .tabs a { position: relative; display: flex; align-items: center; gap: var(--s2); min-height: 38px; padding: 0 var(--s4); border-radius: 11px; font-weight: 600; color: var(--muted); text-decoration: none; white-space: nowrap; }
  .tabs a:hover { color: var(--ink); }
  .tabs a[aria-current="page"] { background: var(--paper); color: var(--ink); box-shadow: var(--lift); }
  .tabs a[aria-current="page"]::after { content: ""; position: absolute; inset: auto var(--s3) 3px; height: 3px; border-radius: 2px; background: var(--live); }
  svg { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
  .sp { flex: 1; }
  .icon { width: 40px; padding: 0; }
  .belt { position: sticky; top: 0; z-index: 20; background: var(--bg); } .belt:empty { display: none; }
  main { padding-top: var(--s4); outline: none; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .skip { position: absolute; left: var(--s4); top: -100px; padding: var(--s2) var(--s4); border-radius: var(--r-control); background: var(--paper); color: var(--ink); z-index: 50; }
  .skip:focus { top: var(--s2); }
  @media (max-width: 759px) {
    :global(:root) { --tabbar: calc(73px + env(safe-area-inset-bottom)); }
    .shell { padding: 0 var(--s4) calc(var(--tabbar) + var(--s6)); }
    .top { gap: var(--s2); min-height: 54px; }
    .word { font-size: 20px; }
    .tabs { position: fixed; z-index: 30; left: 0; right: 0; bottom: 0; height: var(--tabbar); display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; padding: var(--s2) 10px calc(var(--s2) + env(safe-area-inset-bottom)); border-radius: 0; border-width: 1px 0 0; border-color: var(--line-2); background: var(--paper); }
    .tabs a { flex-direction: column; justify-content: center; gap: 3px; min-height: 56px; padding: 0; border-radius: var(--r-card); font-size: 12.5px; }
    .tabs a[aria-current="page"] { background: var(--sunk); box-shadow: none; }
    .tabs a[aria-current="page"]::after { inset: 0 30% auto; }
    .tabs svg { width: 22px; height: 22px; }
  }
</style>
