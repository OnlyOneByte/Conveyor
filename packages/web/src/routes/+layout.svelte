<script lang="ts">
  import Belt from "#lib/components/Belt.svelte";
  import Keyboard from "#lib/components/Keyboard.svelte";
  import Login from "#lib/components/Login.svelte";
  import NavTabs from "#lib/components/NavTabs.svelte";
  import ThemeToggle from "#lib/components/ThemeToggle.svelte";
  import { measured } from "#lib/ui/behaviour.js";
  import Toasts from "#lib/ui/Toasts.svelte";
  import "#lib/styles/app.css";
  import { onMount } from "svelte";
  import { shareActive } from "#lib/active-jobs.js";
  import { announce, announcements } from "#lib/announce.js";
  import {
    cancelJob,
    fetchActiveJobs,
    fetchJobHistoryEntry,
    fetchJobSnapshot,
    logout,
    openJobSocket,
    signedIn,
  } from "#lib/api.js";
  import { createBelt, createTicker, localClock, onJobSent, POLL_MS } from "#lib/belt.js";
  import { createEnds, ENDS_MS, http } from "#lib/belt-ends.js";
  import { createNewsDesk } from "#lib/belt-news.js";
  import { loadCatalog } from "#lib/catalog.js";
  import { rerunOnMake } from "#lib/rerun.js";
  import type { TrackJob } from "#lib/track.js";
  import { toasts } from "#lib/ui/behaviour.js";
  import { invalidateAll } from "$app/navigation";
  import type { LayoutData } from "./$types";

  export let data: LayoutData;

  const { polite, assertive } = announcements;

  $: showApp = signedIn(data.auth);

  let beltJobs: TrackJob[] = [],
    beltEnded: TrackJob[] = [],
    beltOffline = false,
    endsDown = false;
  let [finishedToday, needs]: [number | undefined, TrackJob[]] = [undefined, []];
  const toasted = new Set<string>();
  const ends = createEnds(
    { ...http, entry: fetchJobHistoryEntry, cancel: cancelJob, catalog: () => loadCatalog() },
    {
      show: (finished, failures) => {
        [finishedToday, needs] = [finished, failures];
      },
      down: (down) => {
        endsDown = down;
      },
      toast: (text, action) => toasts.show(text, action),
      say: (text, level) => void announce(text, level),
      pick: rerunOnMake,
    },
    { toasted },
  );
  const refreshEnds = () =>
    showApp && document.visibilityState === "visible" && void ends.refresh();
  const desk = createNewsDesk(announce, undefined, toasted);
  const belt = createBelt(
    {
      active: shareActive(fetchActiveJobs),
      final: fetchJobSnapshot,
      socket: openJobSocket,
      catalog: () => loadCatalog(),
      clock: localClock,
    },
    (jobs, ended, offline) => {
      [beltJobs, beltEnded, beltOffline] = [jobs, ended, offline];
    },
    (news) => {
      desk(news);
      if (news.length) refreshEnds();
    },
  );
  const tick = createTicker(
    { poll: () => belt.poll(), covered: () => belt.covered() },
    () => showApp && document.visibilityState === "visible",
  );
  onMount(() => {
    tick();
    refreshEnds();
    const timers = [setInterval(tick, POLL_MS), setInterval(refreshEnds, ENDS_MS)];
    document.addEventListener("visibilitychange", tick);
    const unsent = onJobSent(() => {
      tick.force();
      refreshEnds();
    });
    return () => {
      for (const timer of timers) clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      for (const stop of [belt.stop, unsent]) stop();
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
      <NavTabs />
    {/if}
    <span class="sp"></span>
    {#if showApp}<Keyboard />{/if}
    <ThemeToggle />
    {#if showApp && data.auth.authEnabled}
      <button class="btn ghost" type="button" on:click={signOut}>Sign out</button>
    {/if}
  </header>
  <div class="belt" id="belt" use:measured={"belt-h"}>{#if showApp}<Belt jobs={beltJobs} ended={beltEnded} offline={beltOffline || endsDown} onAction={ends.act} {finishedToday} {needs} />{/if}</div>
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
  .word { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: var(--fs-brand); letter-spacing: -0.03em; text-transform: lowercase; text-decoration: none; color: var(--ink); }
  .bars { display: flex; gap: 3px; }
  .bars b { width: 7px; height: 18px; border-radius: var(--r-tiny); background: var(--accent); transform: skewX(-14deg); }
  .bars b:nth-child(2) { opacity: 0.6; }
  .bars b:nth-child(3) { opacity: 0.3; }
  .sp { flex: 1; }
  @media (pointer: coarse) { .word { min-height: var(--tap); } }
  .belt { position: sticky; top: 0; z-index: 20; background: var(--bg); } .belt:empty { display: none; }
  main { padding-top: var(--s4); outline: none; }
  .skip { position: absolute; left: var(--s4); top: -100px; padding: var(--s2) var(--s4); border-radius: var(--r-control); background: var(--paper); color: var(--ink); z-index: 50; }
  .skip:focus { top: var(--s2); }
  @media (max-width: 759px) {
    :global(:root) { --tabbar: calc(73px + env(safe-area-inset-bottom)); }
    .shell { padding: 0 var(--s4) calc(var(--tabbar) + var(--s6)); }
    .top { gap: var(--s2); min-height: 54px; }
  }
</style>
