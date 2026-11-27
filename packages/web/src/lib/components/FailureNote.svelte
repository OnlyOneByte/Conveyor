<script lang="ts">
  export let failure: { title: string; detail: string };
</script>

<div class="why" role="note"><strong>{failure.title}</strong><p>{failure.detail}</p></div>

<style>
  .why {
    margin-bottom: var(--s5); padding: var(--s4); border: 1.5px solid var(--err);
    border-radius: var(--r-card); background: color-mix(in oklch, var(--err) 10%, transparent);
  }
  .why:last-child { margin-bottom: 0; }
  strong { display: block; color: var(--err); font-size: var(--fs-section); }
  p { margin: 0; }
</style>
