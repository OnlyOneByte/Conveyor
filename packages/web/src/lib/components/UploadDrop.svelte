<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let name = "";
  export let uploading = false;
  export let ready = false;
  export let error = "";

  const dispatch = createEventDispatcher<{ file: File }>();
  let over = false;

  function take(file: File | null | undefined) {
    over = false;
    if (file) dispatch("file", file);
  }
</script>

<label
  class="drop" class:over class:bad={error} class:ready
  on:dragover|preventDefault={() => (over = true)} on:dragleave={() => (over = false)}
  on:drop|preventDefault={(event) => take(event.dataTransfer?.files?.[0])}
>
  <input
    type="file" accept=".stl" aria-describedby={error ? "upload-error" : undefined}
    aria-invalid={error ? "true" : undefined}
    on:change={(event) => take(event.currentTarget.files?.[0])}
  />
  {#if uploading}
    <b>Uploading {name}…</b>
  {:else if ready}
    <b>{name}</b><span>Ready to print. Drop another file to replace it.</span>
  {:else}
    <b>Drop an STL file here</b><span>or click to choose one</span>
  {/if}
</label>
{#if error}<p id="upload-error" class="error" role="alert">{error}</p>{/if}

<style>
  .drop {
    position: relative; display: grid; place-items: center; gap: var(--s1); min-height: 148px;
    padding: var(--s5); border: 2px dashed var(--field-line); border-radius: var(--r-card);
    background: var(--paper); text-align: center; cursor: pointer;
  }
  .drop:hover, .drop.over { border-color: var(--ink); }
  .drop:focus-within { outline: 3px solid var(--focus); outline-offset: 2px; }
  .drop.ready { border-style: solid; border-color: var(--ok); }
  .drop.bad { border-color: var(--err); }
  b { font-size: 17px; overflow-wrap: anywhere; }
  span { color: var(--muted); }
  input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
  .error { margin: var(--s2) 0 0; color: var(--err); font-weight: 600; }
</style>
