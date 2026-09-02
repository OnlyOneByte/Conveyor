<script lang="ts">
  import type { FormGroup, FormUiHints } from "@conveyor/shared";
  import {
    clamp, controlFor, fieldLabel, groupSummary, hi, lo, numOf,
    type JsonSchemaProp, type Props,
  } from "$lib/form-schema";

  // One group of the generated config form: optional heading + readout, then its
  // fields laid out per `group.layout`. Rendered identically whether the group is in
  // the primary section or inside the "More options" disclosure.
  export let group: FormGroup;
  export let schemaProps: Props;
  export let value: Record<string, unknown>;
  export let ui: FormUiHints | null = null;
  /** Mutation is owned by the parent so the whole form dispatches one change event. */
  export let onSet: (key: string, v: unknown) => void;

  $: fields = group.fields.filter((f) => schemaProps[f]);
  $: summary = groupSummary(group, schemaProps, value, ui);
  /**
   * Current value per field, derived reactively.
   *
   * This MUST be a reactive statement rather than a `num(key)` call in the markup:
   * Svelte tracks only the identifiers named in a template expression, so
   * `value={num(key)}` depends on `num` and `key` — never on `value`, whose read is
   * hidden inside the function body. The control would then never re-render and the
   * stepper's number would sit frozen while everything else updated.
   */
  $: cur = Object.fromEntries(
    fields.map((f) => [f, numOf(schemaProps, value, f)]),
  ) as Record<string, number>;

  const num = (key: string) => numOf(schemaProps, value, key);

  function bump(key: string, p: JsonSchemaProp, delta: number) {
    onSet(key, clamp(num(key) + delta, p));
  }

  // Typing is only committed while the value is already legal, so a half-typed "1" on
  // a min-2 field isn't yanked out from under the caret.
  function typed(key: string, p: JsonSchemaProp, raw: string) {
    if (raw.trim() === "") return;
    let n = Number(raw);
    if (!Number.isFinite(n)) return;
    if (p.type === "integer") n = Math.trunc(n);
    if (n >= lo(p) && n <= hi(p)) onSet(key, n);
  }

  // On blur/Enter clamp and force the input back in sync with state — required because
  // an out-of-range entry was never committed, so state may not have changed at all
  // and Svelte would leave the stale text in the box.
  function settle(key: string, p: JsonSchemaProp, el: HTMLInputElement) {
    const raw = el.value.trim();
    let n = raw === "" ? num(key) : Number(raw);
    if (!Number.isFinite(n)) n = num(key);
    if (p.type === "integer") n = Math.trunc(n);
    n = clamp(n, p);
    onSet(key, n);
    el.value = String(n);
  }
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
        <div class="stepper">
          <button
            type="button"
            aria-label={`Decrease ${fieldLabel(key, prop)}`}
            disabled={cur[key] <= lo(prop)}
            on:click={() => bump(key, prop, -1)}>−</button
          >
          <span class="sval">
            <input
              type="number"
              inputmode="numeric"
              aria-label={fieldLabel(key, prop)}
              min={prop.minimum}
              max={prop.maximum}
              step="1"
              value={cur[key]}
              on:input={(e) => typed(key, prop, e.currentTarget.value)}
              on:blur={(e) => settle(key, prop, e.currentTarget)}
              on:keydown={(e) => {
                if (e.key === "Enter") settle(key, prop, e.currentTarget);
              }}
            />
            {#if ui?.unitMm?.[key] !== undefined}<em>u</em>{/if}
          </span>
          <button
            type="button"
            aria-label={`Increase ${fieldLabel(key, prop)}`}
            disabled={cur[key] >= hi(prop)}
            on:click={() => bump(key, prop, 1)}>+</button
          >
        </div>
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
  .ghead b { font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700; }
  .sum { font-size: 0.7rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .spacer { flex: 1; }

  .fields { display: flex; flex-direction: column; gap: 0.5rem; }
  .fields.pair { flex-direction: row; align-items: center; gap: 0.5rem; }
  .fields.pair > .stepper { flex: 1; min-width: 0; }
  .times { color: var(--muted); }

  /* Compact two-column grid for booleans. */
  .fields.cbgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem 0.8rem; }
  .cb { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; cursor: pointer; min-height: 32px; }
  .cb input { margin: 0; }

  /* Editable stepper: −/+ flank a real number input, so ±1 is one tap and an exact
     value can still be typed. The wrapper carries the 44px tap target, so the inner
     input opts out of the global min-height. */
  .stepper { display: flex; align-items: center; background: var(--surface-2);
    border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .stepper button { border: 0; background: transparent; border-radius: 0; width: 40px;
    padding: 0; font-size: 1.05rem; line-height: 1; color: var(--text); flex: none; }
  .stepper button:hover:not(:disabled) { background: var(--border); color: var(--accent); }
  .stepper button:disabled { opacity: 0.35; cursor: not-allowed; }
  .sval { flex: 1; min-width: 0; display: flex; align-items: baseline; justify-content: center; gap: 0.12rem; }
  .sval input { width: 3ch; min-height: 0; padding: 0; border: 0; background: transparent;
    text-align: right; font-weight: 600; font-variant-numeric: tabular-nums;
    color: var(--text); -moz-appearance: textfield; appearance: textfield; }
  .sval input::-webkit-outer-spin-button,
  .sval input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .sval em { font-style: normal; color: var(--muted); font-size: 0.8rem; }

  .stack1 { display: flex; flex-direction: column; gap: 0.3rem; width: 100%; }
  .stack1 label { font-size: 0.85rem; color: var(--muted); }
  .slider { display: flex; align-items: center; gap: 0.6rem; }
  .slider input[type="range"] { flex: 1; }
  .val { min-width: 2ch; text-align: right; font-variant-numeric: tabular-nums; color: var(--accent); font-weight: 600; }
</style>
