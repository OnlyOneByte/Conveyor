<script lang="ts">
  import { toasts } from "#lib/ui/behaviour.js";
  import Button from "#lib/ui/Button.svelte";
  import Dialog from "#lib/ui/Dialog.svelte";
  import Field from "#lib/ui/Field.svelte";
  import Menu from "#lib/ui/Menu.svelte";
  import Switch from "#lib/ui/Switch.svelte";

  let open = false;
  const items = ["Open job", "Print again", "Cancel"].map((label) => ({ label, run: () => toasts.show(label) }));
  const toast = () => toasts.show("Canceled Bin 2x1", { label: "Print again", run: () => toasts.show("Printing") });
</script>

<h1>Primitives</h1>
<section class="card">
  <h2>Dialog and menu</h2>
  <div class="row wrap">
    <Button on:click={() => (open = true)}>Open dialog</Button>
    <Menu label="Job actions" {items} />
    <Button on:click={toast}>Show a toast</Button>
  </div>
</section>
<section class="card">
  <h2>Buttons</h2>
  <div class="row wrap">
    <Button variant="primary">Print</Button>
    <Button>Secondary</Button>
    <Button variant="ghost">Ghost</Button>
    <Button variant="danger">Cancel job</Button>
    <Button disabled>Disabled</Button>
  </div>
</section>
<section class="card grid">
  <h2>Fields</h2>
  <Field label="Name" value="Bin 2x3" hint="Shown on the belt and in Jobs." />
  <Field label="Height" value="42" numeric unit="mm" />
  <Field label="Width" value="0" numeric unit="u" error="Width must be at least 1." />
  <Switch label="Spin the preview" checked />
  <Switch label="Single-key shortcuts" />
</section>

<Dialog title="Cancel Bin 2x1?" bind:open>
  <p>The printer stops and the job moves to Canceled.</p>
  <label class="stack">Reason <select><option>Wrong filament</option><option>Failed first layer</option></select></label>
  <label class="stack">Note <textarea rows="2"></textarea></label>
  <svelte:fragment slot="actions">
    <Button variant="ghost" on:click={() => (open = false)}>Keep printing</Button>
    <Button variant="danger" on:click={() => (open = false)}>Cancel job</Button>
  </svelte:fragment>
</Dialog>

<style>
  section { margin-top: var(--s4); }
  .wrap { flex-wrap: wrap; }
  .grid { display: grid; gap: var(--s4); max-width: 420px; }
  .stack { display: grid; gap: var(--s1); margin-top: var(--s3); }
  textarea { font: inherit; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 0.4rem 0.6rem; }
</style>
