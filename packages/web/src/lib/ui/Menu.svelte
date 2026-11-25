<script lang="ts">
  import { closesOn, focusedIndex, nextIndex, uid } from "./behaviour";

  export let label: string;
  export let items: { label: string; run: () => void }[];
  const id = uid("menu");
  let button: HTMLButtonElement;
  let menu: HTMLDivElement;
  let expanded = false;

  const entries = () => [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];

  function toggled() {
    expanded = menu.matches(":popover-open");
    if (expanded) entries()[0]?.focus();
    else if (menu.contains(document.activeElement)) button.focus();
  }

  function keydown(event: KeyboardEvent) {
    const all = entries();
    const to = nextIndex(event.key, focusedIndex(all), all.length);
    if (to !== null) all[to]?.focus();
    else if (closesOn(event.key)) menu.hidePopover();
    if (to !== null || event.key === "Escape") event.preventDefault();
  }

  function choose(run: () => void) {
    menu.hidePopover();
    run();
  }
</script>

<button bind:this={button} type="button" class="btn" popovertarget={id} aria-haspopup="menu" aria-expanded={expanded} style="anchor-name: --{id}">
  {label}
</button>
<div bind:this={menu} {id} popover role="menu" tabindex="-1" aria-label={label} style="position-anchor: --{id}" on:toggle={toggled} on:keydown={keydown}>
  {#each items as item (item.label)}
    <button type="button" role="menuitem" tabindex="-1" on:click={() => choose(item.run)}>{item.label}</button>
  {/each}
</div>

<style>
  [popover] { inset: auto; top: anchor(bottom); left: anchor(left); margin: var(--s1) 0 0; min-width: 180px; padding: var(--s1); border: 1px solid var(--line); border-radius: var(--r-card); background: var(--paper); color: var(--ink); box-shadow: var(--lift-hi); }
  [role="menuitem"] { display: block; width: 100%; min-height: 30px; padding: 0 var(--s3); border: 0; border-radius: var(--r-control); background: none; text-align: left; }
  [role="menuitem"]:focus-visible { background: var(--sunk); }
  @media (hover: hover) { [role="menuitem"]:hover { background: var(--sunk); } }
  @media (pointer: coarse) { [role="menuitem"] { min-height: var(--tap); } }
</style>
