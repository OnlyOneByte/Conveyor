<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { fileSize } from "#lib/make.js";
  import type { Size } from "#lib/stl-size.js";
  import ErrorDetails from "./ErrorDetails.svelte";
  import StlFit from "./StlFit.svelte";

  export let file: File | null = null;
  export let bed: Size | undefined = undefined;
  export let printer = "";
  export let uploading = false;
  export let ready = false;
  export let error = "";
  export let why: string | null = null;

  const dispatch = createEventDispatcher<{ file: File; clear: null }>();

  $: fileName = file?.name ?? "";
  $: size = file?.size ?? 0;
  let over = false;
  let input: HTMLInputElement;

  function take(file: File | null | undefined) {
    over = false;
    if (file) dispatch("file", file);
  }
</script>

<div class="up">
<label
  class="drop" class:over class:bad={error} class:ready
  on:dragover|preventDefault={() => (over = true)} on:dragleave={() => (over = false)}
  on:drop|preventDefault={(event) => take(event.dataTransfer?.files?.[0])}
>
  <input
    type="file" accept=".stl" aria-describedby={error ? "upload-error" : undefined}
    aria-invalid={error ? "true" : undefined}
    bind:this={input}
    on:change={(event) => (take(event.currentTarget.files?.[0]), (event.currentTarget.value = ""))}
  />
  {#if uploading}
    <b>Uploading {fileName}…</b>
  {:else if ready}
    <b>{fileName}</b><span>{fileSize(size)} · ready to print. Drop another file to replace it.</span>
  {:else}
    <b>Drop an STL file here</b><span>or click to choose one</span>
  {/if}
</label>
{#if error}<p id="upload-error" class="error" role="alert">{error}</p><ErrorDetails detail={why} />{/if}
{#if ready && file}<StlFit {file} {bed} {printer} />{/if}
{#if ready}
  <button type="button" class="btn clear" on:click={() => (dispatch("clear", null), input.focus())}>
    Remove file
  </button>
{/if}
</div>

<style>
  .drop {
    position: relative; display: grid; place-items: center; gap: var(--s1); min-height: 148px;
    padding: var(--s5); border: 2px dashed var(--field-line); border-radius: var(--r-card);
    background: var(--paper); text-align: center; cursor: pointer;
  }
  .drop.over { border-color: var(--ink); }
  @media (hover: hover) { .drop:hover { border-color: var(--ink); } }
  .drop:focus-within { outline: 3px solid var(--focus); outline-offset: 2px; }
  .drop.ready { border-style: solid; border-color: var(--ok); }
  .drop.bad { border-color: var(--err); }
  b { font-size: 17px; overflow-wrap: anywhere; }
  span { color: var(--muted); }
  input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
  .up { display: flex; flex-direction: column; align-items: stretch; }
  .error { margin: var(--s2) 0 0; color: var(--err); font-weight: 600; }
  @media (max-width: 759px) { .error { order: -1; margin: 0 0 var(--s2); } }
  .clear { align-self: flex-start; margin-top: var(--s2); }
</style>
