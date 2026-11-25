<script lang="ts">
  import type { Group } from "#lib/jobs-list.js";
  import JobRow from "./JobRow.svelte";

  export let groups: Group[];
  export let selected: string | undefined;
  export let pick: (id: string) => void;

  const focus = (event: FocusEvent) => {
    const id = event.target instanceof HTMLElement ? event.target.dataset.id : undefined;
    if (id !== undefined) pick(id);
  };
</script>

<div class="list" role="presentation" on:focusin={focus}>
  {#each groups as g (g.title)}
    <h2>{g.title} · {g.rows.length}</h2>
    <ul aria-label={g.title}>{#each g.rows as row (row.id)}<JobRow {row} selected={row.id === selected} />{/each}</ul>
  {/each}
</div>

<style>
  .list { border: 1px solid var(--line); border-radius: var(--r-card); background: var(--paper); overflow: hidden; }
  h2 { margin: 0; padding: 12px 16px 6px; border-top: 1px solid var(--line); background: var(--bg); color: var(--muted); font: 700 var(--fs-label) / 1 var(--display); letter-spacing: 0.08em; text-transform: uppercase; }
  h2:first-child { border-top: 0; }
  ul { margin: 0; padding: 0; list-style: none; }
</style>
