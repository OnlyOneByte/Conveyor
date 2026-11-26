<script lang="ts">
  import { tick } from "svelte";
  import {
    type CatalogPrinter,
    type CatalogProfile,
    fetchActiveJobs,
    fetchPrinterReachable,
  } from "#lib/api.js";
  import { printerStatus } from "#lib/make.js";
  import Notice from "./Notice.svelte";

  export let printers: CatalogPrinter[];
  export let profiles: CatalogProfile[];
  export let hidden = 0;
  export let printerId: string;
  export let profileId: string;

  const MANY = 6;

  let busy: Set<string> | null = null;
  let unreachable = new Set<string>();
  let answered = new Set<string>();
  const asked = new Set<string>();

  fetchActiveJobs().then(
    (active) => (busy = new Set(active.flatMap((job) => (job.printerId ? [job.printerId] : [])))),
    () => (busy = null),
  );

  async function probe(id: string) {
    asked.add(id);
    const answer = await fetchPrinterReachable(id).catch(() => null);
    if (!answer) return;
    answered = new Set([...answered, id]);
    if (!answer.reachable) unreachable = new Set([...unreachable, id]);
  }

  $: for (const { id } of printers) if (!asked.has(id)) void probe(id);

  let list: HTMLDivElement | undefined;
  $: if (list && printerId && printers.length > MANY) void tick().then(() => reveal(list));

  function reveal(scroller: HTMLDivElement | undefined) {
    const pill = scroller?.querySelector("input:checked")?.closest(".pill");
    if (!scroller || !pill) return;
    const [frame, row] = [scroller.getBoundingClientRect(), pill.getBoundingClientRect()];
    if (row.top < frame.top) scroller.scrollTop -= frame.top - row.top;
    else if (row.bottom > frame.bottom) scroller.scrollTop += row.bottom - frame.bottom;
  }
</script>

<fieldset>
  <legend class="label">Printer</legend>
  <div class="pills" class:many={printers.length > MANY} bind:this={list}>
    {#each printers as printer (printer.id)}
      {@const status = printerStatus(printer.id, busy, unreachable, answered)}
      <label class="pill" title={printer.name}>
        <input type="radio" name="printer" value={printer.id} bind:group={printerId} />
        <b>{printer.name}</b>{#if status}<span><span class="sr">, </span>{status}</span>{/if}
      </label>
    {/each}
  </div>
  <div class="live" role="status">{#if unreachable.has(printerId)}<Notice tone="warn" title="{printers.find((p) => p.id === printerId)?.name} isn't answering">
      Send anyway and the job waits in Needs you, ready to retry.
    </Notice>{/if}</div>
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
    <p class="note">No profile works with this printer yet. Add one in <a href="/settings">Settings</a>.</p>
  {/if}
</fieldset>

<style>
  fieldset {
    display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s2); min-width: 0; margin: 0;
    padding: 0; border: 0;
  }
  fieldset + fieldset { margin-top: var(--s4); }
  .label { padding: 0; }
  .pills { --row: 42px; display: flex; flex-wrap: wrap; gap: var(--s2); }
  .pill {
    display: inline-flex; align-items: center; gap: var(--s2);
    min-height: var(--row); padding: 0 var(--s4);
    border: 1.5px solid var(--field-line); border-radius: var(--r-pill); font-weight: 600; cursor: pointer;
  }
  .pill { position: relative; max-width: 100%; min-width: 0; }
  .pill b {
    min-width: 0; overflow: hidden; font-weight: inherit; text-overflow: ellipsis; white-space: nowrap;
  }
  .pill span { flex: none; font: 500 var(--fs-mono) var(--mono); color: var(--muted); }
  .many {
    flex-direction: column; flex-wrap: nowrap;
    max-height: calc(var(--s1-5) + 4.5 * var(--row) + 4 * var(--s2));
    overflow-y: auto; overscroll-behavior: contain; padding: var(--s1-5); scrollbar-gutter: stable;
  }
  .many .pill { flex: none; justify-content: space-between; border-radius: var(--r-control); }
  .pill:has(:checked) { background: var(--ink); border-color: var(--ink); color: var(--bg); }
  .pill:has(:checked) span { color: var(--bg); opacity: 0.85; }
  .pill:has(:focus-visible) { outline: 3px solid var(--focus); outline-offset: 2px; }
  input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
  .note { margin: 0; color: var(--muted); }
  .live:empty { position: absolute; }
  @media (pointer: coarse) { .pills { --row: var(--tap); } }
</style>
