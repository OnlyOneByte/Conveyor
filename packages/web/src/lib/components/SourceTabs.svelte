<script lang="ts">
  import { nextIndex } from "#lib/ui/behaviour.js";

  export let tabs: { id: string; label: string }[];
  export let value: string;
  export let panel: string;

  const AXIS: Record<string, string> = { ArrowRight: "ArrowDown", ArrowLeft: "ArrowUp" };
  let buttons: HTMLButtonElement[] = [];

  function keydown(event: KeyboardEvent, at: number) {
    const to = nextIndex(AXIS[event.key] ?? event.key, at, tabs.length);
    const tab = to === null ? undefined : tabs[to];
    if (to === null || !tab) return;
    event.preventDefault();
    value = tab.id;
    buttons[to]?.focus();
  }
</script>

<div class="tabs" role="tablist" aria-label="What to print">
  {#each tabs as tab, i (tab.id)}
    <button
      bind:this={buttons[i]} type="button" role="tab" id="tab-{tab.id}" aria-controls={panel}
      aria-selected={value === tab.id} tabindex={value === tab.id ? 0 : -1}
      on:click={() => (value = tab.id)} on:keydown={(event) => keydown(event, i)}
    >{tab.label}</button>
  {/each}
</div>

<style>
  .tabs {
    display: flex; gap: var(--s1); padding: var(--s1); border-radius: var(--r-pill);
    background: var(--sunk); border: 1.5px solid var(--field-line); width: fit-content;
  }
  button {
    min-height: 38px; padding: 0 var(--s4); border: 0; border-radius: var(--r-pill);
    background: transparent; color: var(--ink); font-weight: 650;
  }
  @media (hover: hover) { button:hover:not([aria-selected="true"]) { background: var(--paper); } }
  [aria-selected="true"] { background: var(--ink); color: var(--bg); }
  @media (pointer: coarse) { button { min-height: var(--tap); } }
</style>
