<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import type { Diagnose, EditorHandle, Lang } from "#lib/code-editor.js";
  import Notice from "./Notice.svelte";

  export let file: string;
  export let text: string;
  export let lang: Lang;
  export let label: string;
  export let described: string;
  export let invalid: boolean;
  export let diagnose: Diagnose;
  export let change: (text: string) => void;
  export let ready = false;

  let host: HTMLDivElement;
  let editor: EditorHandle | null = null;
  let shown = file;
  let [failed, busy] = [false, false];

  async function load() {
    if (busy) return;
    busy = true;
    const module = await import("#lib/code-editor.js").catch(() => null);
    busy = false;
    if (!module) {
      failed = true;
      return;
    }
    failed = false;
    await tick();
    const check = (t: string) => diagnose(t);
    editor = module.createEditor(host, { text, lang, label, described, change, diagnose: check });
    ready = true;
    host.querySelector<HTMLElement>(".cm-content")?.focus();
  }

  onMount(load);

  $: if (editor && file !== shown) {
    shown = file;
    editor.load(text, lang, label);
  }

  onDestroy(() => editor?.destroy());
</script>

{#if failed}
  <Notice tone="warn" title="You're offline" role="alert">
    <span>This profile opens once Conveyor is reachable again.</span>
    <button slot="action" class="btn" type="button" aria-disabled={busy} on:click={load}>{busy ? "Trying…" : "Try again"}</button>
  </Notice>
{:else}
  <div class="code" class:bad={invalid} bind:this={host}>
    {#if !editor}<p class="note">Loading the editor…</p>{/if}
  </div>
{/if}

<style>
  .code {
    height: clamp(320px, calc(100dvh - 450px), 720px); overflow: hidden;
    border: 1.5px solid var(--field-line); border-radius: var(--r-control);
    background: var(--paper);
  }
  .code.bad { border-color: var(--err); }
  .code:focus-within { outline: 3px solid var(--focus); outline-offset: 2px; }
  .note { margin: 0; padding: var(--s4); color: var(--muted); }
  .btn { min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body); }
  @media (max-width: 759px) { .code { height: max(240px, calc(100dvh - 600px)); } }
</style>
