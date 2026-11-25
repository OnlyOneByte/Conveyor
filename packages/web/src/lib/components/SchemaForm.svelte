<script lang="ts">
  import { createEventDispatcher, onMount } from "svelte";
  import type { FormUiHints } from "@conveyor/shared";
  import SchemaGroup from "./SchemaGroup.svelte";
  import { primaryGroups, resolveRoot, type JsonSchema } from "#lib/form-schema.js";

  export let schema: JsonSchema | null = null;
  export let value: Record<string, unknown> = {};
  export let ui: FormUiHints | null = null;
  export let title: string;
  export let moreTitle: string;

  const dispatch = createEventDispatcher<{ change: Record<string, unknown> }>();

  $: root = resolveRoot(schema);
  $: schemaProps = root?.properties ?? {};

  let seeded = false;
  let mounted = false;
  let seedPending = false;
  $: if (root && !seeded) {
    const next: Record<string, unknown> = { ...value };
    for (const [k, p] of Object.entries(schemaProps)) {
      if (next[k] === undefined && p.default !== undefined) next[k] = p.default;
    }
    value = next;
    seeded = true;
    if (mounted) dispatch("change", value);
    else seedPending = true;
  }

  function set(key: string, v: unknown) {
    value = { ...value, [key]: v };
    dispatch("change", value);
  }

  $: primary = primaryGroups(schemaProps, ui);
  $: advanced = ui?.advanced ?? null;

  onMount(() => {
    mounted = true;
    if (seedPending) {
      seedPending = false;
      dispatch("change", value);
    }
  });
</script>

{#if root && Object.keys(schemaProps).length}
  <section class="q">
    <h2>{title}</h2>
    {#each primary as group}
      <SchemaGroup {group} {schemaProps} {value} {ui} onSet={set} />
    {/each}
    {#if ui?.note}<p class="note">{ui.note}</p>{/if}
  </section>
  {#if advanced}
    <section class="q">
      <h2>{moreTitle}</h2>
      {#each advanced.groups as group}
        <SchemaGroup {group} {schemaProps} {value} {ui} onSet={set} />
      {/each}
    </section>
  {/if}
{:else}
  <section class="q">
    <h2>{title}</h2>
    <p class="none">No configurable parameters.</p>
  </section>
{/if}

<style>
  .q { display: flex; flex-direction: column; }
  .q :global(.group + .group) { margin-top: 1.05rem; }
  h2 { margin: 0 0 10px; font-size: var(--fs-section); }
  .none { margin: 0; color: var(--muted); }
  .note { margin: 0.6rem 0 0; font-size: 0.75rem; color: var(--muted); }
</style>
