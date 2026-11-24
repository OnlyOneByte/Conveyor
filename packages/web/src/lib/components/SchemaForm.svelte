<script lang="ts">
  import { createEventDispatcher, onMount } from "svelte";
  import type { FormUiHints } from "@conveyor/shared";
  import SchemaGroup from "./SchemaGroup.svelte";
  import { primaryGroups, resolveRoot, type JsonSchema } from "#lib/form-schema.js";

  // A JSON Schema (paramJsonSchema output) describing the generator's params.
  // We render one control per property — zero per-generator UI code (ADR: dynamic forms).
  export let schema: JsonSchema | null = null;
  export let value: Record<string, unknown> = {};
  // Optional presentation hints from the generator: grouping, which fields are
  // advanced, preferred controls, unit→mm mapping. Without them every field renders
  // in one flat group, exactly as this form behaved before hints existed.
  export let ui: FormUiHints | null = null;
  export let title: string;
  export let moreTitle: string;

  const dispatch = createEventDispatcher<{ change: Record<string, unknown> }>();

  $: root = resolveRoot(schema);
  $: schemaProps = root?.properties ?? {};

  // Seed defaults from the schema once, when the schema first resolves.
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
    // A dispatch from a reactive statement can run during component INIT, before the
    // parent has attached its on:change listener — so this event used to be dropped
    // and the parent kept its empty params object. Measured effect: printing without
    // touching the form POSTed `params: {}`, and the job's durable history row
    // recorded no parameters at all. Defer to onMount when we are not mounted yet.
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

{#if root}
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
{/if}

<style>
  .q { display: flex; flex-direction: column; }
  .q :global(.group + .group) { margin-top: 1.05rem; }
  h2 { margin: 0 0 10px; font-size: var(--fs-section); }
  .note { margin: 0.6rem 0 0; font-size: 0.75rem; color: var(--muted); }
</style>
