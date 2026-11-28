<script lang="ts">
  import Menu from "#lib/ui/Menu.svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";

  export let summary: string;
  export let ready: boolean;
  export let failed: boolean;
  export let empty: boolean;
  export let add: () => Promise<void>;
  export let check: () => void;

  export let button: HTMLButtonElement | null = null;
  export let fallback: HTMLButtonElement | null = null;
  let linked = false;
  let opening = false;

  async function take() {
    if (opening) return;
    opening = true;
    await add();
    opening = false;
  }

  $: if (ready && !linked && page.url.searchParams.has("add")) void fromLink();

  async function fromLink() {
    linked = true;
    await goto("/printers", { replace: true, reset: false });
    const target = button ?? fallback;
    target?.focus();
    target?.click();
  }
</script>

<div class="head">
  <div class="t">
    <h1>Printers</h1>
    {#if summary}<p class="sub">{summary}</p>{/if}
  </div>
  <div class="acts">
    {#if !failed && !empty}<button
      class="btn primary big" type="button" bind:this={button} on:click={take} aria-busy={opening}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      {opening ? "Opening…" : "Add printer"}
    </button>{/if}
    <Menu
      label="More"
      items={[
        { label: "Check printers again", run: check },
        { label: "Settings", run: () => goto("/settings") },
      ]}
    />
  </div>
</div>

<style>
  .head {
    display: flex; align-items: flex-end; gap: var(--s4); flex-wrap: wrap;
    margin: var(--s2) 0 var(--s5);
  }
  .t { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: var(--s1); }
  h1 { margin: 0; line-height: 1.05; }
  p { margin: 0; }
  .sub { color: var(--muted); }
  .acts { display: flex; gap: var(--s2); flex-wrap: wrap; }
  .acts :global(.btn), .big {
    min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body);
    border-color: var(--field-line);
  }
  .acts .primary { border-color: var(--accent); }
  .big svg {
    width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.2;
    stroke-linecap: round;
  }
  @media (max-width: 759px) {
    .acts { width: 100%; }
    .acts .primary { flex: 1; }
  }
</style>
