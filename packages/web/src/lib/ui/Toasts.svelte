<script lang="ts">
  import { toasts } from "./behaviour";
  let back: HTMLElement | null = null;
  const inside = (e: FocusEvent) => e.currentTarget instanceof Node && e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget);
</script>

<div class="toasts" role="status">
  {#each $toasts as toast (toast.id)}
    <div
      class="toast"
      role="group"
      aria-label={toast.text}
      on:focusin={(e) => { if (!inside(e)) back = e.relatedTarget instanceof HTMLElement ? e.relatedTarget : null; toasts.hold(toast.id, "focus"); }}
      on:focusout={(e) => inside(e) || toasts.release(toast.id, "focus")}
      on:pointerenter={() => toasts.hold(toast.id, "pointer")} on:pointerleave={() => toasts.release(toast.id, "pointer")}
    >
      <span>{toast.text}</span>
      {#if toast.action}
        {@const action = toast.action}
        <button type="button" class="btn" on:click={() => { toasts.dismiss(toast.id); action.run(); back?.focus(); }}>{action.label}</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .toasts { position: fixed; bottom: var(--s5); inset-inline: var(--s4); display: grid; justify-items: center; gap: var(--s2); z-index: 10; pointer-events: none; }
  .toast { display: flex; align-items: center; gap: var(--s3); padding: var(--s2) var(--s2) var(--s2) var(--s4); border-radius: var(--r-chip); background: var(--ink); color: var(--bg); box-shadow: var(--lift-hi); font-weight: 650; pointer-events: auto; }
</style>
