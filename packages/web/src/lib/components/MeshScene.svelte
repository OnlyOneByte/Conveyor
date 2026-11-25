<script lang="ts">
  import { T } from "@threlte/core";
  import { onDestroy } from "svelte";
  import * as THREE from "three";
  import { parseStl } from "#lib/parse-stl.js";
  import { prefersReducedMotion, spinPreview, theme } from "#lib/preferences.js";
  import { tokenColor } from "#lib/token-color.js";
  import Orbit from "./Orbit.svelte";

  export let file: File | null = null;

  let geometry: THREE.BufferGeometry | null = null;
  let radius = 60;
  let pending: AbortController | null = null;

  $: loadFile(file);

  async function loadFile(f: File | null) {
    pending?.abort();
    geometry = null;
    if (!f) return;
    const controller = new AbortController();
    pending = controller;
    const parsed = await parseStl(f, controller.signal);
    if (controller.signal.aborted || !parsed) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(parsed.position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(parsed.normal, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), parsed.radius);
    radius = parsed.radius;
    geometry = geo;
  }

  onDestroy(() => pending?.abort());

  $: camDist = radius * 2.6;

  const reducedMotion = prefersReducedMotion();
  $: autoRotate = $spinPreview && !reducedMotion;
</script>

<T.PerspectiveCamera makeDefault position={[camDist, camDist * 0.8, camDist]} fov={45}>
  <Orbit {autoRotate} />
</T.PerspectiveCamera>

<T.AmbientLight intensity={0.6} />
<T.DirectionalLight position={[50, 80, 40]} intensity={1.4} />
<T.DirectionalLight position={[-40, 20, -30]} intensity={0.5} />

{#if geometry}
  <T.Mesh {geometry}>
    <T.MeshStandardMaterial color={tokenColor("--accent", $theme)} metalness={0.1} roughness={0.6} />
  </T.Mesh>
  <T.GridHelper args={[Math.max(radius * 4, 200), 10, 0x2d333b, 0x1f262e]} position={[0, -radius, 0]} />
{/if}
