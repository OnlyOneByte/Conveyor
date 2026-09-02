<script lang="ts">
  import { T } from "@threlte/core";
  import { OrbitControls } from "@threlte/extras";
  import { spinPreview, prefersReducedMotion } from "$lib/preferences";
  import { buildGeometry, boundingRadius, binHeight, type GridfinityPreviewParams } from "$lib/previews/gridfinity";

  // The current params object — drives a reactive geometry rebuild (sub-ms).
  export let params: Partial<GridfinityPreviewParams> = {};

  // Rebuild the THREE.Group whenever params change. This is the "wicked-fast" path:
  // no network, no server round-trip — pure client geometry assembly.
  $: group = buildGeometry(params);
  $: radius = boundingRadius(params);
  $: camDist = radius * 2.4;
  // buildGeometry recenters the bin on the origin, so its underside sits at -h/2.
  // The grid is a GROUND plane, so it belongs there — not at -radius (the bounding
  // sphere), which left it floating tens of mm below the model.
  $: groundY = -binHeight(params) / 2;

  // Auto-spin is opt-in (Settings → Preferences) and off by default. Users who asked
  // the OS for reduced motion never get it: autoRotate is a render-loop prop, not a
  // CSS animation, so app.css's @media guard cannot cover it.
  const reducedMotion = prefersReducedMotion();
  $: autoRotate = $spinPreview && !reducedMotion;
</script>

<T.PerspectiveCamera makeDefault position={[camDist, camDist * 0.8, camDist]} fov={45}>
  <OrbitControls enableDamping {autoRotate} autoRotateSpeed={0.6} target={[0, 0, 0]} />
</T.PerspectiveCamera>

<T.AmbientLight intensity={0.6} />
<T.DirectionalLight position={[50, 80, 40]} intensity={1.4} />
<T.DirectionalLight position={[-40, 20, -30]} intensity={0.5} />

<!-- Procedural bin. `is` mounts the prebuilt THREE.Group directly. -->
<T is={group} />

<!-- Ground grid for scale reference -->
<T.GridHelper args={[420, 10, 0x2d333b, 0x1f262e]} position={[0, groundY, 0]} />
