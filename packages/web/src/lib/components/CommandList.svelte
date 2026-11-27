<script lang="ts">
  import { type Command, matchCommands } from "#lib/commands.js";
  import { nextIndex } from "#lib/ui/behaviour.js";

  export let open = false;
  export let commands: Command[] = [];
  export let query = "";
  export let id: string;
  export let current: string | undefined = undefined;
  let active = 0;

  $: results = matchCommands(commands, query);
  $: groups = [...new Set(results.map((c) => c.group))];
  $: if (!open || active >= results.length) active = 0;
  $: current = results[active] ? `${id}-${active}` : undefined;

  const run = (command: Command | undefined) => {
    if (!command) return;
    open = false;
    command.run();
  };

  export function keydown(event: KeyboardEvent) {
    const to = nextIndex(event.key, active, results.length);
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && to !== null) active = to;
    else if (event.key === "Enter") run(results[active]);
    else return;
    event.preventDefault();
  }
</script>

<div id="{id}-list" role="listbox" aria-label="Results">
  {#each groups as group}
    <div role="group" aria-labelledby="{id}-{group}">
      <div id="{id}-{group}" class="head label" role="presentation">{group}</div>
      {#each results as command, i}
        {#if command.group === group}
          <div id="{id}-{i}" role="option" tabindex="-1" class:stack={command.group === "Jobs"} aria-selected={i === active} on:click={() => run(command)} on:keydown={keydown} on:pointermove={() => (active = i)}>
            {command.label}{#if command.hint}<span class="hint"
              ><span class="sr">, </span>{command.hint}</span
            >{/if}
          </div>
        {/if}
      {/each}
    </div>
  {/each}
</div>
{#if open && results.length === 0}<p class="none" role="status">No matches</p>{/if}

<style>
  [role="listbox"] { max-height: 50vh; overflow-y: auto; padding-bottom: var(--s2); }
  .head { padding: var(--s3) var(--s4) var(--s1); }
  [role="option"] { display: flex; align-items: center; gap: var(--s3); min-height: var(--tap); padding: 0 var(--s4); cursor: pointer; }
  [role="option"][aria-selected="true"] { background: var(--sunk); box-shadow: inset 3px 0 0 var(--focus); }
  .hint { margin-left: auto; font: 500 var(--fs-mono) var(--mono); color: var(--muted); }
  .none { margin: 0; padding: var(--s4); color: var(--muted); }
  @media (max-width: 759px) {
    .stack { flex-wrap: wrap; row-gap: var(--s0); padding: var(--s1-5) var(--s4); }
    .stack .hint { flex-basis: 100%; margin-left: 0; }
  }
</style>
