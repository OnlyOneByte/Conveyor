<script lang="ts">
  export let label: string;
  export let checked = false;
  export let disabled = false;
</script>

<button type="button" role="switch" class="switch" aria-checked={checked} {disabled} on:click={() => (checked = !checked)}>
  <span class="track" aria-hidden="true"><span class="thumb"></span></span>{label}
</button>

<style>
  .switch { display: inline-flex; align-items: center; gap: var(--s2); min-height: 30px; padding: 0; border: 0; background: none; color: var(--ink); }
  .track { width: 34px; height: 20px; border-radius: 10px; background: var(--line-2); padding: 2px; transition: background var(--t-fast); }
  .thumb { display: block; width: 16px; height: 16px; border-radius: 50%; background: var(--paper); box-shadow: var(--lift); transition: transform var(--t-fast) var(--ease-pop); }
  [aria-checked="true"] .track { background: var(--ink); }
  [aria-checked="true"] .thumb { transform: translateX(14px); }
  @media (pointer: coarse) { .switch { min-height: var(--tap); } }
</style>
