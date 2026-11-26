<script lang="ts">
  import { focusedIndex, rememberFocus, TABBABLE, uid, wrapTab } from "./behaviour";

  export let title: string;
  export let open = false;
  const id = uid("dialog");
  let dialog: HTMLDialogElement;
  let restore = () => {};

  const active = () =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  $: if (dialog && open && !dialog.open) {
    restore = rememberFocus(active);
    dialog.showModal();
  }
  $: if (dialog && !open && dialog.open) dialog.close();

  function closed() {
    open = false;
    restore();
  }

  function trap(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    const all = [...dialog.querySelectorAll<HTMLElement>(TABBABLE)].filter(
      (el) => el.checkVisibility() && !el.closest("[inert]"),
    );
    const to = wrapTab(event.shiftKey, focusedIndex(all), all.length);
    if (to === null) return;
    event.preventDefault();
    all[to]?.focus();
  }
</script>

<dialog bind:this={dialog} aria-labelledby={id} on:close={closed} on:keydown={trap}>
  <h2 {id}>{title}</h2>
  <slot />
  <div class="actions"><slot name="actions" /></div>
</dialog>

<style>
  dialog { width: min(440px, calc(100vw - 2 * var(--s4))); padding: var(--s5); border: 1px solid var(--line); border-radius: var(--r-panel); background: var(--raised); color: var(--ink); box-shadow: var(--lift-hi); }
  dialog::backdrop { background: color-mix(in oklch, var(--belt) 55%, transparent); }
  h2 { margin: 0 0 var(--s3); }
  .actions { display: flex; justify-content: flex-end; gap: var(--s2); margin-top: var(--s5); }
</style>
