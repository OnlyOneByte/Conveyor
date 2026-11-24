<script lang="ts">
  const demo = import.meta.env.VITE_CONVEYOR_PRIMITIVES === "1" ? import("./TrackDemo.svelte") : null;
</script>

{#if demo}
  {#await demo then page}<svelte:component this={page.default} />{/await}
{/if}
