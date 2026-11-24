<script lang="ts">
  import { Canvas } from "@threlte/core";
  import { ACESFilmicToneMapping } from "three";
  import MeshScene from "./MeshScene.svelte";
  import PreviewScene from "./PreviewScene.svelte";

  export let params: Record<string, unknown> = {};
  export let file: File | null = null;
</script>

<Canvas toneMapping={ACESFilmicToneMapping}>
  {#if file}<MeshScene {file} />{:else}<PreviewScene {params} />{/if}
</Canvas>
