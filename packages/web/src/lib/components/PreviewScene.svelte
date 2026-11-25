<script lang="ts">
  import { T } from "@threlte/core";
  import Orbit from "./Orbit.svelte";
  import { spinPreview, prefersReducedMotion } from "#lib/preferences.js";
  import { buildGeometry, boundingRadius, binHeight, type GridfinityPreviewParams } from "#lib/previews/gridfinity.js";

  export let params: Partial<GridfinityPreviewParams> = {};

  $: group = buildGeometry(params);
  $: radius = boundingRadius(params);
  $: camDist = radius * 2.4;
  $: groundY = -binHeight(params) / 2;

  const reducedMotion = prefersReducedMotion();
  $: autoRotate = $spinPreview && !reducedMotion;
</script>

<T.PerspectiveCamera makeDefault position={[camDist, camDist * 0.8, camDist]} fov={45}>
  <Orbit {autoRotate} />
</T.PerspectiveCamera>

<T.AmbientLight intensity={0.6} />
<T.DirectionalLight position={[50, 80, 40]} intensity={1.4} />
<T.DirectionalLight position={[-40, 20, -30]} intensity={0.5} />

<T is={group} />

<T.GridHelper args={[420, 10, 0x2d333b, 0x1f262e]} position={[0, groundY, 0]} />
