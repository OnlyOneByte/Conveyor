<script lang="ts">
  import { fileLabel } from "#lib/profile-check.js";

  export let files: string[];
  export let current: string;
  export let panel: string;
  export let flagged: string | null = null;

  let list: HTMLElement;

  function move(event: KeyboardEvent, at: number) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    const ends = { Home: 0, End: files.length - 1 }[event.key];
    const to = step ? (at + step + files.length) % files.length : ends;
    if (to === undefined) return;
    event.preventDefault();
    current = files[to] ?? current;
    list.querySelectorAll<HTMLElement>("[role=tab]")[to]?.focus();
  }
</script>

<div class="tabs" role="tablist" aria-label="Files" bind:this={list}>
  {#each files as file, at (file)}
    <button
      type="button"
      role="tab"
      aria-selected={current === file}
      aria-controls={panel}
      tabindex={current === file ? 0 : -1}
      on:click={() => (current = file)}
      on:keydown={(e) => move(e, at)}
    >
      {fileLabel(file)}{#if flagged === file}
        <span class="flag"><span class="sr">, has an error</span></span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .tabs { display: flex; gap: var(--s1); border-bottom: 1px solid var(--line); }
  button {
    display: inline-flex; align-items: center; gap: var(--s2); min-height: 44px;
    padding: 0 var(--s3);
    border: 0; border-bottom: 3px solid transparent; background: none; color: var(--muted);
    font: 500 13px var(--mono); cursor: pointer;
  }
  [aria-selected="true"] { color: var(--ink); border-bottom-color: var(--live); }
  button:focus-visible { outline: 3px solid var(--focus); outline-offset: -3px; }
  .flag { width: 8px; height: 8px; border-radius: 50%; background: var(--err); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
