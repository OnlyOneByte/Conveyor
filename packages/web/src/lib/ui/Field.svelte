<script lang="ts">
  import { uid } from "./behaviour";

  export let label: string;
  export let value = "";
  export let numeric = false;
  export let unit = "";
  export let hint = "";
  export let error = "";
  const id = uid("field");
  $: described = [unit && `${id}-unit`, hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ");
</script>

<div class="field">
  <label for={id}>{label}</label>
  <div class="box" class:bad={error}>
    <input
      {id}
      {value}
      inputmode={numeric ? "decimal" : undefined}
      aria-invalid={error ? "true" : undefined}
      aria-describedby={described || undefined}
      on:input={(e) => (value = e.currentTarget.value)}
    />
    {#if unit}<span id="{id}-unit" class="unit">{unit}</span>{/if}
  </div>
  {#if hint}<p id="{id}-hint" class="hint">{hint}</p>{/if}
  {#if error}<p id="{id}-error" class="error">{error}</p>{/if}
</div>

<style>
  .field { display: grid; gap: var(--s1); }
  label { font-weight: 650; }
  .box { display: flex; align-items: center; border: 1.5px solid var(--field-line); border-radius: var(--r-control); background: var(--paper); }
  .box:focus-within { outline: 3px solid var(--focus); outline-offset: 2px; }
  .box.bad { border-color: var(--err); }
  input { flex: 1; min-width: 0; border: 0; background: transparent; min-height: 30px; outline: none; }
  .unit { padding: 0 var(--s3); font: 500 var(--fs-chip) var(--mono); color: var(--muted); }
  .hint, .error { margin: 0; font-size: var(--fs-chip); color: var(--muted); }
  .error { color: var(--err); }
  @media (pointer: coarse) { input { min-height: var(--tap); } }
</style>
