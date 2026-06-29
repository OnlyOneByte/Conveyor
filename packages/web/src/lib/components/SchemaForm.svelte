<script lang="ts">
  import { createEventDispatcher } from "svelte";

  // A JSON Schema (zod-to-json-schema output) describing the generator's params.
  // We render one control per property — zero per-generator UI code (ADR: dynamic forms).
  export let schema: JsonSchema | null = null;
  export let value: Record<string, unknown> = {};

  interface JsonSchema {
    type?: string;
    properties?: Record<string, JsonSchemaProp>;
    required?: string[];
    $ref?: string;
    definitions?: Record<string, JsonSchema>;
  }
  interface JsonSchemaProp {
    type?: string;
    description?: string;
    minimum?: number;
    maximum?: number;
    default?: unknown;
    enum?: unknown[];
  }

  const dispatch = createEventDispatcher<{ change: Record<string, unknown> }>();

  // zod-to-json-schema wraps the object behind $ref → definitions[name]. Resolve it.
  function resolveRoot(s: JsonSchema | null): JsonSchema | null {
    if (!s) return null;
    if (s.$ref && s.definitions) {
      const name = s.$ref.replace("#/definitions/", "");
      return s.definitions[name] ?? s;
    }
    return s;
  }

  $: root = resolveRoot(schema);
  $: props = root?.properties ?? {};

  // Seed defaults from the schema once, when the schema first resolves.
  let seeded = false;
  $: if (root && !seeded) {
    const next: Record<string, unknown> = { ...value };
    for (const [k, p] of Object.entries(props)) {
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

  function label(key: string, p: JsonSchemaProp): string {
    return p.description ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  }
</script>

{#if root}
  <div class="form">
    {#each Object.entries(props) as [key, prop]}
      <div class="field">
        <label for={`f-${key}`}>{label(key, prop)}</label>

        {#if prop.type === "boolean"}
          <input
            id={`f-${key}`}
            type="checkbox"
            checked={Boolean(value[key])}
            on:change={(e) => set(key, e.currentTarget.checked)}
          />
        {:else if prop.type === "integer" || prop.type === "number"}
          {#if prop.minimum !== undefined && prop.maximum !== undefined}
            <div class="slider">
              <input
                id={`f-${key}`}
                type="range"
                min={prop.minimum}
                max={prop.maximum}
                step={prop.type === "integer" ? 1 : "any"}
                value={Number(value[key] ?? prop.default ?? prop.minimum)}
                on:input={(e) => set(key, Number(e.currentTarget.value))}
              />
              <span class="val">{value[key] ?? prop.default ?? prop.minimum}</span>
            </div>
          {:else}
            <input
              id={`f-${key}`}
              type="number"
              value={Number(value[key] ?? prop.default ?? 0)}
              on:input={(e) => set(key, Number(e.currentTarget.value))}
            />
          {/if}
        {:else}
          <input
            id={`f-${key}`}
            type="text"
            value={String(value[key] ?? prop.default ?? "")}
            on:input={(e) => set(key, e.currentTarget.value)}
          />
        {/if}
      </div>
    {/each}
  </div>
{:else}
  <p class="muted">No configurable parameters.</p>
{/if}

<style>
  .form { display: flex; flex-direction: column; gap: 0.85rem; }
  .field { display: flex; flex-direction: column; gap: 0.3rem; }
  .field label { font-size: 0.85rem; color: var(--muted); }
  .slider { display: flex; align-items: center; gap: 0.6rem; }
  .slider input[type="range"] { flex: 1; }
  .val { min-width: 2ch; text-align: right; font-variant-numeric: tabular-nums; color: var(--accent); font-weight: 600; }
</style>
