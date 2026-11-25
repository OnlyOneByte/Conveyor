<script lang="ts">
  import { createEventDispatcher, onMount, tick } from "svelte";
  import { LoginError, login } from "#lib/login.js";

  const dispatch = createEventDispatcher<{ authed: Record<string, never> }>();

  const MESSAGES: Record<number, string> = {
    401: "That password didn't work. Try again.",
    429: "Too many tries. Wait a minute, then try again.",
  };

  let password = "";
  let shown = false;
  let busy = false;
  let error: string | null = null;
  let input: HTMLInputElement;

  onMount(() => input.focus());

  async function submit() {
    if (!password || busy) return;
    busy = true;
    error = null;
    try {
      await login(password);
      dispatch("authed", {});
    } catch (e) {
      const status = e instanceof LoginError ? e.status : undefined;
      error =
        status === undefined
          ? "Can't reach Conveyor. Check that it's running, then try again."
          : (MESSAGES[status] ?? "Sign-in didn't work. Try again.");
      password = "";
      await tick();
      input.focus();
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Sign in · Conveyor</title></svelte:head>

<div class="gate">
  <form class="card" on:submit|preventDefault={submit} aria-labelledby="signin-title">
    <h1 id="signin-title">Sign in</h1>
    <p class="muted">Enter the password for this Conveyor.</p>
    <label for="password">Password</label>
    <div class="field" class:bad={error}>
      <input
        id="password"
        bind:this={input}
        type={shown ? "text" : "password"}
        value={password}
        on:input={(e) => (password = e.currentTarget.value)}
        autocomplete="current-password"
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? "password-error" : undefined}
      />
      <button class="reveal" type="button" aria-controls="password" on:click={() => (shown = !shown)}>
        {shown ? "Hide" : "Show"}<span class="sr"> password</span>
      </button>
    </div>
    {#if error}<p class="err" id="password-error" role="alert"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20L12 3ZM12 10v4M12 17v.5" /></svg>{error}</p>{/if}
    <button class="primary" type="submit" disabled={busy || !password}>{busy ? "Signing in…" : "Sign in"}</button>
    <p class="hint">Forgot it? Whoever set up this Conveyor can change it.</p>
  </form>
</div>

<style>
  .gate { display: grid; place-items: start center; padding: 12vh var(--s4) var(--s6); }
  .card { display: flex; flex-direction: column; gap: var(--s4); width: min(380px, 100%); padding: var(--s6) var(--s5); }
  h1 { margin: 0; font-size: var(--fs-title); }
  p { margin: 0; }
  label { font-weight: 600; }
  .field { display: flex; align-items: center; min-height: var(--tap); border: 1.5px solid var(--field-line); border-radius: var(--r-control); background: var(--bg); }
  .field.bad { border-color: var(--err); }
  .field:focus-within { outline: 3px solid var(--focus); outline-offset: 2px; }
  input { flex: 1; min-width: 0; border: 0; background: none; outline: none; font: 500 var(--fs-body) var(--mono); }
  .reveal { min-height: 36px; margin-right: var(--s1); padding: 0 var(--s3); border: 0; border-radius: var(--r-inner); background: var(--sunk); font-size: var(--fs-chip); font-weight: 600; }
  .err svg { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
  .err { display: flex; gap: var(--s2); align-items: flex-start; padding: var(--s3); border-radius: var(--r-control); background: color-mix(in oklch, var(--err) 10%, transparent); color: var(--err); font-weight: 600; }
  .primary { min-height: 48px; font-size: var(--fs-body); font-weight: 800; }
  .hint { font-size: var(--fs-chip); color: var(--faint); }
</style>
