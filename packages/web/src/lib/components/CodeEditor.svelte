<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { Diagnose, EditorHandle, Lang } from "#lib/code-editor.js";

  export let file: string;
  export let text: string;
  export let lang: Lang;
  export let label: string;
  export let described: string;
  export let invalid: boolean;
  export let diagnose: Diagnose;
  export let change: (text: string) => void;

  let host: HTMLDivElement;
  let editor: EditorHandle | null = null;
  let shown = file;
  let failed = false;

  onMount(async () => {
    try {
      const { createEditor } = await import("#lib/code-editor.js");
      const check = (t: string) => diagnose(t);
      editor = createEditor(host, { text, lang, label, described, change, diagnose: check });
      host.querySelector<HTMLElement>(".cm-content")?.focus();
    } catch {
      failed = true;
    }
  });

  $: if (editor && file !== shown) {
    shown = file;
    editor.load(text, lang, label);
  }

  onDestroy(() => editor?.destroy());
</script>

<div class="code" class:bad={invalid} bind:this={host}>
  {#if failed}
    <p class="note" role="alert">
      The editor needs a connection to load. Reconnect, then reload the page.
    </p>
  {:else if !editor}
    <p class="note">Loading the editor…</p>
  {/if}
</div>

<style>
  .code {
    height: clamp(320px, calc(100dvh - 450px), 720px); overflow: hidden;
    border: 1.5px solid var(--field-line); border-radius: var(--r-control);
    background: var(--paper);
  }
  .code.bad { border-color: var(--err); }
  .code:focus-within { outline: 3px solid var(--focus); outline-offset: 2px; }
  .note { margin: 0; padding: var(--s4); color: var(--muted); }
  @media (max-width: 759px) { .code { height: max(240px, calc(100dvh - 600px)); } }
</style>
