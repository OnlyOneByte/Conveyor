<script lang="ts">
  import { onMount } from "svelte";
  import {
    type CatalogPrinter, type CatalogProfile, fetchActiveJobs, fetchPrinterReachable,
  } from "#lib/api.js";
  import { printerStatus } from "#lib/make.js";

  export let printers: CatalogPrinter[];
  export let profiles: CatalogProfile[];
  export let hidden = 0;
  export let printerId: string;
  export let profileId: string;

  let busy = new Set<string>();
  let unreachable = new Set<string>();

  onMount(async () => {
    const active = await fetchActiveJobs().catch(() => []);
    busy = new Set(active.flatMap((job) => (job.printerId ? [job.printerId] : [])));
    const checks = printers.map(async ({ id }) => {
      const answer = await fetchPrinterReachable(id).catch(() => null);
      if (answer && !answer.reachable) unreachable = new Set([...unreachable, id]);
    });
    await Promise.all(checks);
  });
</script>

<fieldset>
  <legend class="label">Printer</legend>
  <div class="pills">
    {#each printers as printer (printer.id)}
      <label class="pill">
        <input type="radio" name="printer" value={printer.id} bind:group={printerId} />
        {printer.name}<span>{printerStatus(printer.id, busy, unreachable)}</span>
      </label>
    {/each}
  </div>
  {#if hidden}<p class="note">{hidden} more can't print this kind of job.</p>{/if}
</fieldset>

<fieldset>
  <legend class="label">Profile</legend>
  {#if profiles.length}
    <div class="pills">
      {#each profiles as profile (profile.id)}
        <label class="pill">
          <input type="radio" name="profile" value={profile.id} bind:group={profileId} />
          {profile.name}
        </label>
      {/each}
    </div>
  {:else}
    <p class="note">No profile works with this printer yet. Add one in Settings.</p>
  {/if}
</fieldset>

<style>
  fieldset { display: grid; gap: var(--s2); margin: 0; padding: 0; border: 0; }
  fieldset + fieldset { margin-top: var(--s4); }
  .label {
    padding: 0; font: 500 var(--fs-label) var(--mono); text-transform: uppercase;
    letter-spacing: 0.09em; color: var(--muted);
  }
  .pills { display: flex; flex-wrap: wrap; gap: var(--s2); }
  .pill {
    display: inline-flex; align-items: center; gap: var(--s2);
    min-height: 42px; padding: 0 var(--s4);
    border: 1.5px solid var(--field-line); border-radius: 21px; font-weight: 600; cursor: pointer;
  }
  .pill span { font: 500 12px var(--mono); color: var(--muted); }
  .pill:has(:checked) { background: var(--ink); border-color: var(--ink); color: var(--bg); }
  .pill:has(:checked) span { color: var(--bg); opacity: 0.85; }
  .pill:has(:focus-visible) { outline: 3px solid var(--focus); outline-offset: 2px; }
  input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
  .note { margin: 0; color: var(--muted); }
  @media (pointer: coarse) { .pill { min-height: var(--tap); } }
</style>
