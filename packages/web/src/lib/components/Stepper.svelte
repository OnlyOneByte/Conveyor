<script lang="ts">
  import { clamp, hi, type JsonSchemaProp, lo } from "#lib/form-schema.js";

  export let label: string;
  export let prop: JsonSchemaProp;
  export let current: number;
  export let unitMm: number | undefined = undefined;
  export let onSet: (v: number) => void;

  function typed(raw: string) {
    if (raw.trim() === "") return;
    let n = Number(raw);
    if (!Number.isFinite(n)) return;
    if (prop.type === "integer") n = Math.trunc(n);
    if (n >= lo(prop) && n <= hi(prop)) onSet(n);
  }

  function settle(el: HTMLInputElement) {
    const raw = el.value.trim();
    let n = raw === "" ? current : Number(raw);
    if (!Number.isFinite(n)) n = current;
    if (prop.type === "integer") n = Math.trunc(n);
    n = clamp(n, prop);
    onSet(n);
    el.value = String(n);
  }
</script>

<div class="stepper">
  <button
    type="button"
    aria-label={`Decrease ${label}`}
    disabled={current <= lo(prop)}
    on:click={() => onSet(clamp(current - 1, prop))}>−</button
  >
  <span class="sval">
    <input
      type="number"
      inputmode="numeric"
      aria-label={label}
      min={prop.minimum}
      max={prop.maximum}
      step="1"
      value={current}
      on:input={(e) => typed(e.currentTarget.value)}
      on:blur={(e) => settle(e.currentTarget)}
      on:keydown={(e) => {
        if (e.key === "Enter") settle(e.currentTarget);
      }}
    />
    {#if unitMm !== undefined}<em>u · {current * unitMm} mm</em>{/if}
  </span>
  <button
    type="button"
    aria-label={`Increase ${label}`}
    disabled={current >= hi(prop)}
    on:click={() => onSet(clamp(current + 1, prop))}>+</button
  >
</div>

<style>
  .stepper { display: flex; align-items: center; background: var(--sunk);
    border: 1.5px solid var(--field-line); border-radius: var(--r-control); overflow: hidden; }
  button { border: 0; background: transparent; border-radius: 0; width: 40px;
    padding: 0; font-size: var(--fs-section); line-height: 1; color: var(--ink); flex: none; }
  @media (hover: hover) {
    button:hover:not(:disabled) { background: var(--line-2); color: var(--live); }
  }
  button:disabled { opacity: 0.35; cursor: not-allowed; }
  button:focus-visible { outline-offset: -3px; }
  .sval { flex: 1; min-width: 0; display: flex; align-items: baseline; justify-content: center;
    gap: var(--s0); }
  .sval input { width: 3ch; min-height: 0; padding: 0; border: 0; background: transparent;
    text-align: right; font-weight: 600; font-variant-numeric: tabular-nums;
    color: var(--ink); -moz-appearance: textfield; appearance: textfield; }
  .sval input::-webkit-outer-spin-button,
  .sval input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .sval em { font-style: normal; color: var(--muted); font-size: var(--fs-mono); white-space: nowrap; }
</style>
