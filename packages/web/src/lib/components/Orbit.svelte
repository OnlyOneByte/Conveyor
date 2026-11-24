<script lang="ts">
  import { isInstanceOf, T, useParent, useTask, useThrelte } from "@threlte/core";
  import { onDestroy } from "svelte";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

  export let autoRotate = false;

  const { dom, camera, invalidate } = useThrelte();
  const parent = useParent();
  const controls = new OrbitControls(isInstanceOf($parent, "Camera") ? $parent : $camera, dom);
  controls.enableDamping = true;
  controls.autoRotateSpeed = 0.6;
  $: controls.autoRotate = autoRotate;

  useTask(() => controls.update(), { autoInvalidate: false });
  onDestroy(() => controls.dispose());
</script>

<T is={controls} onchange={invalidate} />
