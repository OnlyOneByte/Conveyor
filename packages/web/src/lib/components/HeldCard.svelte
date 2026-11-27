<script lang="ts">
  export let hold = false;
  let height = 0;
  let held = 0;

  $: if (!hold) held = height;
</script>

<div bind:clientHeight={height} style:min-height={hold && held ? `${held}px` : null}><slot /></div>
