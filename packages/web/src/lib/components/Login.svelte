<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { login } from "$lib/api";

  const dispatch = createEventDispatcher<{ authed: { role: string } }>();

  let password = "";
  let busy = false;
  let error: string | null = null;

  async function submit() {
    if (!password || busy) return;
    busy = true;
    error = null;
    try {
      const { role } = await login(password);
      dispatch("authed", { role });
    } catch (e) {
      error = (e as Error).message;
      password = "";
    } finally {
      busy = false;
    }
  }
</script>

<div class="gate">
  <form class="card" on:submit|preventDefault={submit}>
    <div class="brand"><span class="logo">▦</span> Conveyor</div>
    <p class="muted">Enter the password to continue.</p>
    <!-- svelte-ignore a11y-autofocus -->
    <input
      type="password"
      placeholder="Password"
      bind:value={password}
      autofocus
      autocomplete="current-password"
    />
    <button class="primary" type="submit" disabled={busy || !password}>
      {busy ? "Checking…" : "Enter"}
    </button>
    {#if error}<p class="err">{error}</p>{/if}
  </form>
</div>

<style>
  .gate { min-height: 70vh; display: flex; align-items: center; justify-content: center; }
  .card { display: flex; flex-direction: column; gap: 0.85rem; width: min(22rem, 90vw); padding: 1.5rem; }
  .brand { display: flex; align-items: center; gap: 0.5rem; font-weight: 800; font-size: 1.4rem; }
  .logo { color: var(--accent); }
  input { width: 100%; padding: 0.6rem; }
  .primary { width: 100%; }
  .err { color: var(--danger); font-size: 0.85rem; margin: 0; }
  p { margin: 0; }
</style>
