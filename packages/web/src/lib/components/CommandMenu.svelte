<script lang="ts">
  import type { Command } from "#lib/commands.js";
  import { rememberFocus, uid } from "#lib/ui/behaviour.js";

  export let open = false;
  export let commands: Command[] = [];
  export let List: typeof import("./CommandList.svelte").default | null = null;
  export let failed = false;
  const id = uid("cmd");
  let dialog: HTMLDialogElement;
  let list: { keydown: (event: KeyboardEvent) => void } | null = null;
  let query = "";
  let current: string | undefined;
  let restore = () => {};

  $: if (dialog && open && !dialog.open) {
    restore = rememberFocus(() =>
      document.activeElement instanceof HTMLElement ? document.activeElement : null,
    );
    query = "";
    dialog.showModal();
  }
  $: if (dialog && !open && dialog.open) dialog.close();
</script>

<dialog bind:this={dialog} aria-label="Command menu" on:close={() => ((open = false), restore())}>
  <input role="combobox" aria-expanded={List !== null} aria-controls={List ? `${id}-list` : undefined} aria-autocomplete="list" aria-activedescendant={current}
    aria-label="Search jobs, printers and actions" placeholder="Search jobs, printers and actions" autocomplete="off" bind:value={query} on:keydown={(e) => list?.keydown(e)} />
  {#if List}
    <svelte:component this={List} bind:this={list} bind:open bind:current {commands} {query} {id} />
  {:else}
    <p class="none" role="status">{failed ? "Search didn't load. Reload the page to try again." : "Loading…"}</p>
  {/if}
  <p class="keys" aria-hidden="true"><kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>↵</kbd> open · <kbd>esc</kbd> close</p>
</dialog>

<style>
  dialog { width: min(600px, calc(100vw - 24px)); margin: calc(var(--s4) * 7) auto auto; padding: 0; border: 1px solid var(--line-2); border-radius: var(--r-card); background: var(--raised); color: var(--ink); box-shadow: var(--lift-hi); }
  dialog::backdrop { background: color-mix(in oklch, var(--belt) 35%, transparent); }
  input { width: 100%; height: 56px; padding: 0 var(--s4); border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: none; font-size: var(--fs-section); }
  input:focus-visible { outline: none; box-shadow: inset 0 -3px 0 var(--focus); }
  .none { margin: 0; padding: var(--s4); color: var(--muted); }
  .keys { display: flex; gap: var(--s2); margin: 0; padding: var(--s2-5) var(--s4); border-top: 1px solid var(--line); font-size: var(--fs-mono); color: var(--muted); }
  @media (max-width: 759px) {
    dialog { margin-top: var(--s4); }
    .keys { display: none; }
  }
</style>
