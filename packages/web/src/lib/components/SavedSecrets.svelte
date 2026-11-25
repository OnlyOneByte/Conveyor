<script lang="ts">
  import { uid } from "#lib/ui/behaviour.js";

  export let label: string;
  export let saved: boolean;
  export let cleared: boolean;
  export let busy: boolean;
  export let clear: () => Promise<void>;

  const ARM_MS = 500;
  const question = uid("clear-question");
  let [asking, back, askedAt] = [false, false, 0];
  const focus = (el: HTMLElement, on = true) => void (on && el.focus());
  $: named = `${/^[AEIOU]/.test(label) ? "An" : "A"} ${label}`;
  $: if (!saved) asking = false;

  const ask = () => ([asking, askedAt] = [true, performance.now()]);
  const pointerTooSoon = (event: MouseEvent) =>
    event.detail !== 0 && performance.now() - askedAt < ARM_MS;
  const confirm = (event: MouseEvent) => {
    if (busy || pointerTooSoon(event)) return;
    void clear();
  };
</script>

{#if saved && asking}
  <div class="saved" role="group" aria-label="Clear saved secrets" aria-describedby={question}>
    <span id={question}>Clear the saved {label} now? Cancel won't bring it back.</span>
    <button class="btn ghost" type="button" aria-describedby={question} use:focus on:click={() => ([asking, back] = [false, true])}>Keep it</button>
    <button class="btn danger" type="button" aria-disabled={busy} on:click={confirm}>Clear it</button>
  </div>
{:else if saved}
  <div class="saved">
    <span>{named} is saved for this printer. It stays until you clear it.</span>
    <button class="btn" type="button" disabled={busy} use:focus={back} on:click={ask}>Clear saved secrets</button>
  </div>
{:else if cleared}
  <p class="saved" role="status" tabindex="-1" use:focus>Saved {label} cleared.</p>
{/if}

<style>
  p { margin: 0; }
  .saved { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s3); padding: var(--s3); border-radius: var(--r-control); background: var(--sunk); color: var(--muted); }
  .saved span { flex: 1; min-width: 12rem; }
  @media (pointer: coarse) { .btn { min-height: var(--tap); } }
</style>
