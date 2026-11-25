<script lang="ts">
  import type { GeneratorSummary } from "#lib/api.js";

  export let generators: GeneratorSummary[] = [];
  export let restrict = false;
  export let allowed: string[] = [];

  const toggle = (id: string, on: boolean) =>
    (allowed = on ? [...allowed, id] : allowed.filter((g) => g !== id));
</script>

<fieldset>
  <legend class="sr">Models</legend>
  <label class="check"><input type="checkbox" bind:checked={restrict} />Only some kinds of model can print here</label>
  {#if restrict}
    <div class="gens">
      {#each generators as g (g.id)}
        <label class="check"><input type="checkbox" checked={allowed.includes(g.id)} on:change={(e) => toggle(g.id, e.currentTarget.checked)} />{g.name}</label>
      {/each}
    </div>
    {#if !allowed.length}<p class="hint">Tick at least one, or this printer takes no jobs.</p>{/if}
  {/if}
</fieldset>

<style>
  fieldset { margin: 0; padding: 0; border: 0; display: flex; flex-direction: column; gap: var(--s1); }
  .check { display: flex; align-items: center; gap: var(--s2); min-height: 30px; }
  .check input { flex: none; margin: 0; }
  .gens { display: flex; flex-direction: column; margin-left: 26px; }
  .hint { margin: 0; font-size: var(--fs-chip); color: var(--muted); }
  @media (pointer: coarse) { .check { min-height: var(--tap); } }
</style>
