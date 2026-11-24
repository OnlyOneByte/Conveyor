<script lang="ts">
  import { announce } from "#lib/announce.js";
  import { cancelJob } from "#lib/api.js";

  export let id: string;
  export let printing: boolean;

  let canceling = false;

  async function cancel() {
    canceling = true;
    await cancelJob(id).catch(() => {
      canceling = false;
      announce("Couldn't cancel. Try again.", "assertive");
    });
  }
</script>

<button class="btn danger" type="button" disabled={canceling} on:click={cancel}>
  {canceling ? "Canceling…" : printing ? "Cancel print" : "Cancel"}
</button>

<style>
  .btn {
    min-height: var(--tap); padding: 0 var(--s4); font-size: var(--fs-body);
    color: var(--err); border-color: var(--err);
  }
</style>
