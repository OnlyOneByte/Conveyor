<script lang="ts">
  import { Canvas } from "@threlte/core";
  import { ACESFilmicToneMapping } from "three";
  import MeshScene from "#lib/components/MeshScene.svelte";
  import PreviewScene from "#lib/components/PreviewScene.svelte";

  export let preview: boolean;
  export let params: Record<string, unknown>;
  export let file: File | null;
  export let upload: boolean;
</script>

<div class="mat">
  {#if upload && file}
    <Canvas toneMapping={ACESFilmicToneMapping}><MeshScene {file} /></Canvas>
  {:else if upload}
    <p class="empty">Your model shows here once you choose a file.</p>
  {:else if preview}
    <Canvas toneMapping={ACESFilmicToneMapping}><PreviewScene {params} /></Canvas>
  {:else}
    <p class="empty">This model is made when it prints, so there's no preview.</p>
  {/if}
</div>

<style>
  .mat {
    position: sticky; top: var(--s4); display: grid; place-items: center; height: 540px;
    border-radius: var(--r-panel); background: var(--mat);
    overflow: hidden; box-shadow: var(--lift);
  }
  .mat > :global(*) { grid-area: 1 / 1; width: 100%; height: 100%; }
  .empty {
    width: auto; height: auto; max-width: calc(100% - var(--s6)); margin: 0;
    padding: var(--s4) var(--s5); border-radius: var(--r-card);
    background: var(--paper); text-align: center;
  }
  @media (max-width: 759px) { .mat { position: relative; top: 0; height: 180px; } }
</style>
