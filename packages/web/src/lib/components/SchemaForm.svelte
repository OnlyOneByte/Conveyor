<script lang="ts">
  import { createEventDispatcher, onMount } from "svelte";
  import type { FormUiHints } from "@conveyor/shared";
  import SchemaGroup from "./SchemaGroup.svelte";
  import { primaryGroups, resolveRoot, type JsonSchema } from "$lib/form-schema";

  // A JSON Schema (zod-to-json-schema output) describing the generator's params.
  // We render one control per property — zero per-generator UI code (ADR: dynamic forms).
  export let schema: JsonSchema | null = null;
  export let value: Record<string, unknown> = {};
  // Optional presentation hints from the generator: grouping, which fields are
  // advanced, preferred controls, unit→mm mapping. Without them every field renders
  // in one flat group, exactly as this form behaved before hints existed.
  export let ui: FormUiHints | null = null;
  // Namespaces the remembered "More options" state. Usually the generator id.
  export let persistKey = "";

  const dispatch = createEventDispatcher<{ change: Record<string, unknown> }>();

  $: root = resolveRoot(schema);
  $: schemaProps = root?.properties ?? {};

  // Seed defaults from the schema once, when the schema first resolves.
  let seeded = false;
  $: if (root && !seeded) {
    const next: Record<string, unknown> = { ...value };
    for (const [k, p] of Object.entries(schemaProps)) {
      if (next[k] === undefined && p.default !== undefined) next[k] = p.default;
    }
    value = next;
    seeded = true;
    dispatch("change", value);
  }

  function set(key: string, v: unknown) {
    value = { ...value, [key]: v };
    dispatch("change", value);
  }

  $: primary = primaryGroups(schemaProps, ui);
  $: advanced = ui?.advanced ?? null;

  // ── remembered disclosure state ────────────────────────────────────────────
  let advOpen = false;
  const storeKey = () => `conveyor.form.${persistKey || "default"}.advanced`;
  onMount(() => {
    try {
      advOpen = localStorage.getItem(storeKey()) === "1";
    } catch {
      /* storage blocked (private mode) — just start collapsed */
    }
  });
  function rememberAdv(open: boolean) {
    advOpen = open;
    try {
      localStorage.setItem(storeKey(), open ? "1" : "0");
    } catch {
      /* non-fatal */
    }
  }
</script>

{#if root}
  <div class="form">
    {#each primary as group}
      <SchemaGroup {group} {schemaProps} {value} {ui} onSet={set} />
    {/each}

    {#if ui?.note}<p class="note">{ui.note}</p>{/if}

    {#if advanced}
      <details open={advOpen} on:toggle={(e) => rememberAdv(e.currentTarget.open)}>
        <summary><span class="caret" aria-hidden="true">▶</span>{advanced.title}</summary>
        <div class="adv">
          {#each advanced.groups as group}
            <SchemaGroup {group} {schemaProps} {value} {ui} onSet={set} />
          {/each}
        </div>
      </details>
    {/if}
  </div>
{:else}
  <p class="muted">No configurable parameters.</p>
{/if}

<style>
  .form { display: flex; flex-direction: column; }
  .form :global(.group + .group) { margin-top: 1.05rem; }
  .note { margin: 0.6rem 0 0; font-size: 0.7rem; color: var(--muted); }

  details { margin-top: 1rem; border-top: 1px solid var(--border); padding-top: 0.55rem; }
  summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 0.45rem;
    font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted);
    font-weight: 600; min-height: 32px; }
  summary::-webkit-details-marker { display: none; }
  summary:hover { color: var(--accent); }
  .caret { font-size: 0.6rem; color: var(--accent); transition: transform 0.15s; }
  details[open] .caret { transform: rotate(90deg); }
  .adv { padding-top: 0.7rem; }
</style>
