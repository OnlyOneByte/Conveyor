<script lang="ts">
  const demo = import.meta.env.VITE_CONVEYOR_PRIMITIVES === "1" ? import("./Demo.svelte") : null;
</script>

<svelte:head><title>Primitives · Conveyor</title></svelte:head>

{#if demo}
  {#await demo then page}<svelte:component this={page.default} />{/await}
{/if}
