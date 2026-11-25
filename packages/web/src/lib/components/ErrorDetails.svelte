<script lang="ts">
  export let detail: string | null = null;
</script>

{#if detail}
  <details class="why">
    <summary>Details</summary>
    <pre>{detail}</pre>
  </details>
{/if}

<style>
  .why { margin: var(--s2) 0 0; color: var(--ink); font-weight: 400; }
  summary { padding: 6px 0; font-weight: 600; color: var(--muted); cursor: pointer; }
  pre {
    margin: var(--s2) 0 0; padding: var(--s3); border-radius: 10px; background: var(--sunk);
    font: 500 12px var(--mono); white-space: pre-wrap; overflow-wrap: anywhere;
  }
</style>
