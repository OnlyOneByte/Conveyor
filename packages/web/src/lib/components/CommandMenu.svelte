<script lang="ts">
  import { matchCommands, type Command } from "#lib/commands.js";
  import { nextIndex, rememberFocus, uid } from "#lib/ui/behaviour.js";

  export let open = false;
  export let commands: Command[] = [];
  const id = uid("cmd");
  let dialog: HTMLDialogElement;
  let query = "";
  let active = 0;
  let restore = () => {};

  $: results = matchCommands(commands, query);
  $: groups = [...new Set(results.map((c) => c.group))];
  $: if (active >= results.length) active = 0;
  $: if (dialog && open && !dialog.open) {
    restore = rememberFocus(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
    query = "";
    active = 0;
    dialog.showModal();
  }
  $: if (dialog && !open && dialog.open) dialog.close();

  const run = (command: Command | undefined) => { if (!command) return; open = false; command.run(); };

  function keydown(event: KeyboardEvent) {
    const to = nextIndex(event.key, active, results.length);
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && to !== null) active = to;
    else if (event.key === "Enter") run(results[active]);
    else return;
    event.preventDefault();
  }
</script>

<dialog bind:this={dialog} aria-label="Command menu" on:close={() => ((open = false), restore())}>
  <input role="combobox" aria-expanded="true" aria-controls="{id}-list" aria-autocomplete="list" aria-activedescendant={results[active] ? `${id}-${active}` : undefined}
    aria-label="Search jobs, printers and actions" placeholder="Search jobs, printers and actions" autocomplete="off" bind:value={query} on:keydown={keydown} />
  <div id="{id}-list" role="listbox" aria-label="Results">
    {#each groups as group}
      <div role="group" aria-labelledby="{id}-{group}">
        <div id="{id}-{group}" class="head" role="presentation">{group}</div>
        {#each results as command, i}
          {#if command.group === group}
            <div id="{id}-{i}" role="option" tabindex="-1" aria-selected={i === active} on:click={() => run(command)} on:keydown={keydown} on:pointermove={() => (active = i)}>
              {command.label}<span class="hint">{command.hint}</span>
            </div>
          {/if}
        {/each}
      </div>
    {/each}
  </div>
  {#if results.length === 0}<p class="none" role="status">No matches</p>{/if}
  <p class="keys" aria-hidden="true"><kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>↵</kbd> open · <kbd>esc</kbd> close</p>
</dialog>

<style>
  dialog { width: min(600px, calc(100vw - 24px)); margin: 110px auto auto; padding: 0; border: 1px solid var(--line-2); border-radius: var(--r-card); background: var(--paper); color: var(--ink); box-shadow: var(--lift-hi); }
  dialog::backdrop { background: color-mix(in oklch, var(--belt) 35%, transparent); }
  input { width: 100%; height: 56px; padding: 0 var(--s4); border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: none; font-size: 17px; }
  input:focus-visible { outline: none; box-shadow: inset 0 -3px 0 var(--focus); }
  [role="listbox"] { max-height: 50vh; overflow-y: auto; padding-bottom: var(--s2); }
  .head { padding: var(--s3) var(--s4) var(--s1); font: 700 var(--fs-label) / 1 var(--display); text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  [role="option"] { display: flex; align-items: center; gap: var(--s3); min-height: var(--tap); padding: 0 var(--s4); cursor: pointer; }
  [role="option"][aria-selected="true"] { background: var(--sunk); box-shadow: inset 3px 0 0 var(--focus); }
  .hint { margin-left: auto; font: 500 12px var(--mono); color: var(--muted); }
  .none { margin: 0; padding: var(--s4); color: var(--muted); }
  .keys { display: flex; gap: var(--s2); margin: 0; padding: 10px var(--s4); border-top: 1px solid var(--line); font-size: 12.5px; color: var(--muted); }
  @media (max-width: 759px) { dialog { margin-top: var(--s4); } .keys { display: none; } }
</style>
