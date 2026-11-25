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
  .track { box-sizing: border-box; width: 34px; height: 20px; padding: 1.5px; border: 1.5px solid var(--muted); border-radius: var(--r-pill); background: transparent; transition: background var(--t-fast); }
  .thumb { display: block; width: 14px; height: 14px; border-radius: 50%; background: var(--muted); transition: transform var(--t-fast) var(--ease-pop); }
  [aria-checked="true"] .track { border-color: var(--ink); background: var(--ink); }
  [aria-checked="true"] .thumb { background: var(--paper); transform: translateX(14px); }
  @media (pointer: coarse) { .switch { min-height: var(--tap); } }
</style>
