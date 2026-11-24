<script lang="ts">
  import { toasts } from "#lib/ui/behaviour.js";
  import Button from "#lib/ui/Button.svelte";
  import Dialog from "#lib/ui/Dialog.svelte";
  import Menu from "#lib/ui/Menu.svelte";

  let open = false;
  const items = ["Open job", "Print again", "Cancel"].map((label) => ({ label, run: () => toasts.show(label) }));
  const toast = () => toasts.show("Canceled Bin 2×1", { label: "Print again", run: () => toasts.show("Printing") });
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

<Dialog title="Cancel Bin 2×1?" bind:open>
  <p>The printer stops and the job moves to Canceled.</p>
  <svelte:fragment slot="actions">
    <Button variant="ghost" on:click={() => (open = false)}>Keep printing</Button>
    <Button variant="danger" on:click={() => (open = false)}>Cancel job</Button>
  </svelte:fragment>
</Dialog>

<style>
  section { margin-top: var(--s4); }
  .wrap { flex-wrap: wrap; }
</style>
