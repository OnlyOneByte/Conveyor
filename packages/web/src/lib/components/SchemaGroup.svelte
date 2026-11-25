<script lang="ts">
  import type { FormGroup, FormUiHints } from "@conveyor/shared";
  import { controlFor, fieldLabel, groupSummary, numOf, type Props } from "#lib/form-schema.js";
  import Stepper from "./Stepper.svelte";

  export let group: FormGroup;
  export let schemaProps: Props;
  export let value: Record<string, unknown>;
  export let ui: FormUiHints | null = null;
  export let onSet: (key: string, v: unknown) => void;

  $: fields = group.fields.filter((f) => schemaProps[f]);
  $: summary = groupSummary(group, schemaProps, value, ui);
  $: cur = Object.fromEntries(fields.map((f) => [f, numOf(schemaProps, value, f)])) as Record<
    string,
    number
  >;
</script>

<div class="group">
  {#if group.title || summary}
    <div class="ghead">
      {#if group.title}<b>{group.title}</b>{:else}<span class="spacer"></span>{/if}
      {#if summary}<span class="sum">{summary}</span>{/if}
    </div>
  {/if}

  <div class="fields" class:pair={group.layout === "pair"} class:cbgrid={group.layout === "grid"}>
    {#each fields as key, i}
      {@const prop = schemaProps[key]}
      {@const kind = controlFor(key, prop, ui)}
      {#if group.layout === "pair" && i > 0}<span class="times" aria-hidden="true">×</span>{/if}

      {#if kind === "checkbox"}
        <label class="cb">
          <input
            type="checkbox"
            checked={Boolean(value[key])}
            on:change={(e) => onSet(key, e.currentTarget.checked)}
          />
          <span>{fieldLabel(key, prop)}</span>
        </label>
      {:else if kind === "stepper"}
        <Stepper
          label={fieldLabel(key, prop)} {prop} current={cur[key]} unitMm={ui?.unitMm?.[key]}
          onSet={(v) => onSet(key, v)}
        />
      {:else}
        <div class="stack1">
          <label for={`f-${key}`}>{fieldLabel(key, prop)}</label>
          <div class="slider">
            <input
              id={`f-${key}`}
              type="range"
              min={prop.minimum}
              max={prop.maximum}
              step={prop.type === "integer" ? 1 : "any"}
              value={cur[key]}
              on:input={(e) => onSet(key, Number(e.currentTarget.value))}
            />
            <span class="val">{cur[key]}</span>
          </div>
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .ghead { display: flex; align-items: baseline; justify-content: space-between; gap: 0.6rem; margin-bottom: 0.45rem; }
  .ghead b { font-size: var(--fs-label); letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700; }
  .sum { font-size: var(--fs-label); color: var(--muted); font-variant-numeric: tabular-nums; }
  .spacer { flex: 1; }

  .fields { display: flex; flex-direction: column; gap: 0.5rem; }
  .fields.pair { flex-direction: row; align-items: center; gap: 0.5rem; }
  .fields.pair > :global(.stepper) { flex: 1; min-width: 0; }
  .times { color: var(--muted); }

  .fields.cbgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem 0.8rem; }
  .cb { display: flex; align-items: center; gap: 0.5rem; font-size: var(--fs-chip); cursor: pointer; min-height: 32px; }
  .cb input { margin: 0; }
  .stack1 { display: flex; flex-direction: column; gap: 0.3rem; width: 100%; }
  .stack1 label { font-size: var(--fs-chip); color: var(--muted); }
  .slider { display: flex; align-items: center; gap: 0.6rem; }
  .slider input[type="range"] { flex: 1; }
  .val { min-width: 2ch; text-align: right; font-variant-numeric: tabular-nums; color: var(--live); font-weight: 600; }
</style>
