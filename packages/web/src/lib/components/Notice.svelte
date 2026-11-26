<script lang="ts">
  export let tone: "warn" | "err";
  export let title: string;
  export let role: "alert" | null = null;
  export let stamp: unknown = null;
</script>

<div class="notice {tone}">
  <svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
    {#if tone === "err"}
      <circle cx="10" cy="10" r="7.75" />
      <path d="M10 6v4.75M10 13.75v.01" />
    {:else}
      <path d="M10 3 17.75 16.5H2.25Z" />
      <path d="M10 8.25v3.5M10 14v.01" />
    {/if}
  </svg>
  <div class="words">
    <div class="head" {role}>
      {#key stamp}<b>{title}</b><slot name="message" />{/key}
    </div>
    <slot />
  </div>
  {#if $$slots.action}<div class="act"><slot name="action" /></div>{/if}
</div>

<style>
  .notice {
    --tone: var(--live);
    display: flex; gap: var(--s3); align-items: flex-start; padding: var(--s3) var(--s4) var(--s3) var(--s3);
    border: 1.5px solid color-mix(in oklch, var(--tone) 82%, var(--bg)); border-radius: var(--r-control);
    background: color-mix(in oklch, var(--tone) 8%, var(--paper)); color: var(--ink);
    font-size: var(--fs-chip); line-height: 1.45;
  }
  .err { --tone: var(--err); }
  .icon {
    flex: none; width: 20px; height: 20px; margin-top: calc(var(--s0) / 2);
    fill: none; stroke: var(--tone); stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round;
  }
  .words { display: grid; flex: 1; gap: var(--s0); min-width: 0; color: var(--muted); }
  .head { display: grid; gap: var(--s0); }
  .act { flex: none; }
  b { color: var(--ink); font-size: var(--fs-body); font-weight: 650; line-height: 1.3; }
</style>
