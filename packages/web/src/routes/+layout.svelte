<script lang="ts">
  import "$lib/styles/app.css";
  import { onMount } from "svelte";
  import { fetchAuthStatus, logout, type AuthStatus } from "$lib/api";
  import Login from "$lib/components/Login.svelte";

  let status: AuthStatus | null = null;
  let loaded = false;

  onMount(async () => {
    try {
      status = await fetchAuthStatus();
    } catch {
      // API unreachable — fail open to the app shell; it shows its own error card.
      status = { authEnabled: false, authenticated: false, role: null };
    }
    loaded = true;
  });

  // Show the app when auth is disabled OR the user is authenticated.
  $: showApp = !!status && (!status.authEnabled || status.authenticated);
  $: isAdmin = status?.role === "admin";

  function onAuthed(e: CustomEvent<{ role: string }>) {
    status = { authEnabled: true, authenticated: true, role: e.detail.role as AuthStatus["role"] };
  }

  async function doLogout() {
    await logout();
    status = { authEnabled: true, authenticated: false, role: null };
  }
</script>

<div class="shell">
  <header>
    <a href="/" class="brand">
      <span class="logo">▦</span>
      <span>Conveyor</span>
    </a>
    <span class="muted tag">self-hosted · generate → slice → print</span>
    <span class="spacer" />
    {#if showApp && status?.authEnabled}
      {#if isAdmin}<a href="/admin" class="navlink">≡ Admin</a>{/if}
      <button class="ghost" on:click={doLogout}>Log out</button>
    {/if}
  </header>
  <main>
    {#if !loaded}
      <p class="muted">Loading…</p>
    {:else if showApp}
      <slot />
    {:else}
      <Login on:authed={onAuthed} />
    {/if}
  </main>
</div>

<style>
  .shell { max-width: 72rem; margin: 0 auto; padding: 1rem; }
  header {
    display: flex; align-items: baseline; gap: 1rem;
    padding: 0.5rem 0 1rem; border-bottom: 1px solid var(--border); margin-bottom: 1.5rem;
  }
  .brand { display: flex; align-items: center; gap: 0.5rem; font-weight: 700; font-size: 1.2rem; color: var(--text); text-decoration: none; }
  .logo { color: var(--accent); }
  .tag { font-size: 0.85rem; }
  .spacer { flex: 1; }
  .navlink { color: var(--accent); text-decoration: none; font-size: 0.9rem; align-self: center; }
  .ghost { background: transparent; align-self: center; }
  @media (max-width: 540px) { .tag { display: none; } }
</style>
