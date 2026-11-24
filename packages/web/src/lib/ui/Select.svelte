<script lang="ts">
  import { uid } from "./behaviour";

  export let label: string;
  export let value = "";
  export let options: { value: string; label: string }[];
  export let hint = "";
  export let error = "";
  const id = uid("select");
  $: described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ");
</script>

<div class="field">
  <label for={id}>{label}</label>
  <select {id} bind:value class:bad={error} aria-invalid={error ? "true" : undefined} aria-describedby={described || undefined}>
    {#each options as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
  </select>
  {#if hint}<p id="{id}-hint" class="hint">{hint}</p>{/if}
  {#if error}<p id="{id}-error" class="error">{error}</p>{/if}
</div>

<style>
  .field { display: grid; gap: var(--s1); }
  label { font-weight: 650; }
  select { min-height: 33px; padding: 0 var(--s2); border: 1.5px solid var(--field-line); border-radius: var(--r-control); background: var(--paper); color: var(--ink); }
  select.bad { border-color: var(--err); }
  .hint, .error { margin: 0; font-size: var(--fs-chip); color: var(--muted); }
  .error { color: var(--err); }
  @media (pointer: coarse) { select { min-height: var(--tap); } }
</style>
