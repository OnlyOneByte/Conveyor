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
      status = { authEnabled: false, authenticated: false };
    }
    loaded = true;
  });

  // Show the app when auth is disabled OR the user is authenticated. Settings and
  // Job history need nothing further: there is one tier, so anyone who can see the
  // app can reach them — which is also exactly what the server enforces.
  $: showApp = !!status && (!status.authEnabled || status.authenticated);

  function onAuthed() {
    status = { authEnabled: true, authenticated: true };
  }

  async function doLogout() {
    await logout();
    status = { authEnabled: true, authenticated: false };
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
    {#if showApp}
      <!-- Icon-only, so each carries an explicit accessible name; `title` gives sighted
           users the same hover affordance. Inline SVGs rather than ⚙/🗒 characters,
           which render as colour emoji on many platforms and ignore currentColor. -->
      <!-- Route is /history, not /jobs: the API owns the /jobs* namespace (submit,
           status, WS upgrade) and both the vite proxy and Caddy forward that whole
           prefix, so a page there would 404 on direct load. -->
      <a href="/monitor" class="iconlink" aria-label="Monitor" title="Monitor">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M3 12h4l2.5-7 5 14 2.5-7H21"
          />
        </svg>
      </a>
      <a href="/history" class="iconlink" aria-label="Job history" title="Job history">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Zm2.75 2A.75.75 0 0 0 6 8.25c0 .41.34.75.75.75h1a.75.75 0 0 0 0-1.5h-1Zm3.5 0a.75.75 0 0 0 0 1.5h7a.75.75 0 0 0 0-1.5h-7Zm-3.5 3.75a.75.75 0 0 0 0 1.5h1a.75.75 0 0 0 0-1.5h-1Zm3.5 0a.75.75 0 0 0 0 1.5h7a.75.75 0 0 0 0-1.5h-7ZM6.75 15a.75.75 0 0 0 0 1.5h1a.75.75 0 0 0 0-1.5h-1Zm3.5 0a.75.75 0 0 0 0 1.5h7a.75.75 0 0 0 0-1.5h-7Z"
          />
        </svg>
      </a>
      <a href="/settings" class="iconlink" aria-label="Settings" title="Settings">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M19.14 12.94a7.6 7.6 0 0 0 .05-.94 7.6 7.6 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.2 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.62-.06.94s.02.63.06.94L2.32 14.5a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.04.24.25.42.49.42h3.84c.25 0 .46-.18.5-.42l.36-2.54a7.3 7.3 0 0 0 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z"
          />
        </svg>
      </a>
    {/if}
    {#if showApp && status?.authEnabled}
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
  /* Icon-only nav control. Sized to the 44px tap target even though the glyph is 20px,
     so it stays thumb-reachable on mobile. */
  .iconlink {
    display: grid; place-items: center; align-self: center;
    width: var(--tap); height: var(--tap);
    color: var(--muted); border-radius: var(--radius); text-decoration: none;
    transition: color 0.15s, background 0.15s;
  }
  .iconlink:hover { color: var(--accent); background: var(--surface-2); }
  .iconlink:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .ghost { background: transparent; align-self: center; }
  @media (max-width: 540px) { .tag { display: none; } }
</style>
