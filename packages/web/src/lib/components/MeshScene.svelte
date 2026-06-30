<script lang="ts">
  import { T } from "@threlte/core";
  import { OrbitControls } from "@threlte/extras";
  import * as THREE from "three";
  import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

  // Renders the user's *real* uploaded STL mesh (the passthrough source), as
  // opposed to the procedural Gridfinity preview. Same loader powers the future
  // "show exact model after slicing" feature.
  export let file: File | null = null;

  let geometry: THREE.BufferGeometry | null = null;
  let radius = 60;

  const loader = new STLLoader();

  // Re-parse whenever the file changes. STLLoader.parse() is synchronous on an
  // ArrayBuffer — no network, just a local decode.
  $: if (file) loadFile(file);
  $: if (!file) geometry = null;

  async function loadFile(f: File) {
    const buf = await f.arrayBuffer();
    const geo = loader.parse(buf);
    geo.center(); // recenter on origin so OrbitControls frames it
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    radius = geo.boundingSphere?.radius ?? 60;
    geometry = geo;
  }

  $: camDist = radius * 2.6;
</script>

<T.PerspectiveCamera makeDefault position={[camDist, camDist * 0.8, camDist]} fov={45}>
  <OrbitControls enableDamping autoRotate autoRotateSpeed={0.6} target={[0, 0, 0]} />
</T.PerspectiveCamera>

<T.AmbientLight intensity={0.6} />
<T.DirectionalLight position={[50, 80, 40]} intensity={1.4} />
<T.DirectionalLight position={[-40, 20, -30]} intensity={0.5} />

{#if geometry}
  <T.Mesh {geometry}>
    <T.MeshStandardMaterial color="#5eead4" metalness={0.1} roughness={0.6} />
  </T.Mesh>
  <T.GridHelper args={[Math.max(radius * 4, 200), 10, 0x2d333b, 0x1f262e]} position={[0, -radius, 0]} />
{/if}
