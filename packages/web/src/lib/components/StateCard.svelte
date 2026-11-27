<script lang="ts">
  export let title: string;
  export let tone: "empty" | "err" = "empty";
  export let level: "h2" | "h3" | "p" = "p";
  export let role: "alert" | null = null;
</script>

<div class="state {tone}" {role}>
  <svelte:element this={level} class="t">
    {#if tone === "err"}
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="7.75" /><path d="M10 6v4.75M10 13.75v.01" />
      </svg>
    {/if}{title}
  </svelte:element>
  <slot />
</div>

<style>
  .state {
    display: grid; gap: var(--s2); justify-items: start; margin: 0; padding: var(--s5);
    border: 1px dashed var(--line-2); border-radius: var(--r-card); color: var(--muted);
  }
  .err {
    border: 1.5px solid var(--err);
    background: color-mix(in oklch, var(--err) 8%, var(--paper));
  }
  .t {
    display: flex; align-items: center; gap: var(--s2); margin: 0;
    color: var(--ink); font: 700 var(--fs-section) var(--display);
  }
  svg {
    flex: none; width: 20px; height: 20px; fill: none; stroke: var(--err); stroke-width: 1.75;
    stroke-linecap: round;
  }
  .state :global(p) { margin: 0; }
  .state :global(.btn) {
    min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body); text-decoration: none;
  }
</style>
