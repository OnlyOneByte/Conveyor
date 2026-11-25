<script lang="ts">
  import {
    fitOnBed,
    inches,
    looksInInches,
    overBy,
    type Size,
    sizeLine,
  } from "#lib/stl-size.js";
  import { measureStl } from "#lib/measure-stl.js";

  export let file: File;
  export let bed: Size | undefined = undefined;
  export let printer = "";

  let size: Size | null | undefined;
  let measuring: File | null = null;

  $: measure(file);

  async function measure(chosen: File) {
    measuring = chosen;
    size = undefined;
    const measured = await measureStl(chosen);
    if (measuring !== chosen) return;
    size = measured;
  }

  $: flat = size ? Math.max(size.x, size.y, size.z) === 0 : false;
  $: fit = size && bed && !flat ? fitOnBed(size, bed) : null;
  $: tiny = size && !flat && looksInInches(size, bed);
  $: where = printer ? `${printer}'s` : "this printer's";
  $: over = fit?.kind === "over" && size && bed ? overBy(size, bed, fit.sides) : "";
  $: scale = size && bed ? 56 / Math.max(bed.x, bed.y, size.x, size.y) : 0;
  $: lift = size && bed ? 56 / Math.max(bed.z, size.z) : 0;
  $: tone = !size || flat ? "quiet" : fit?.kind === "fits" ? "ok" : fit ? "warn" : "quiet";
</script>

<section class="fit {tone}" aria-label="Model size">
  {#if size && bed && !flat}
    <svg class="plan" viewBox="0 0 84 72" aria-hidden="true">
      <rect class="bed" x={28 - (bed.x * scale) / 2} y={36 - (bed.y * scale) / 2} width={bed.x * scale} height={bed.y * scale} rx="3" />
      <rect class="model" x={28 - (size.x * scale) / 2} y={36 - (size.y * scale) / 2} width={Math.max(size.x * scale, 1.5)} height={Math.max(size.y * scale, 1.5)} rx="1.5" />
      <rect class="bed" x="70" y={64 - bed.z * lift} width="8" height={bed.z * lift} rx="2" />
      <rect class="model" x="71.5" y={64 - size.z * lift} width="5" height={Math.max(size.z * lift, 1.5)} rx="1" />
    </svg>
  {/if}
  <div class="words">
    <span class="label">Size</span>
    {#if size === undefined}
      <b class="dims">Measuring…</b>
    {:else if size === null}
      <b class="dims">Unknown</b>
      <p>Conveyor couldn't read this file's shape. The slicer still checks it when you print.</p>
    {:else}
      <b class="dims">{sizeLine(size)}</b>
      <p role="status">
        {#if flat}
          This model has no size: all of its points sit in one place, so there's nothing to print.
        {:else if !bed || !fit}
          The selected profile doesn't list its bed size, so Conveyor can't check the fit.
        {:else if fit.kind === "fits"}
          Fits {where} {sizeLine(bed)} bed.
        {:else if fit.kind === "turned"}
          Fits {where} bed only turned 90°. Turn it before you print, or the slicer may refuse it.
        {:else}
          Bigger than {where} bed: {over}. You can still send it, but the slicer may refuse it.
        {/if}
      </p>
      {#if tiny}
        <p class="hint">
          This is very small. STL files have no units and slicers read millimetres. If it was drawn
          in inches, it's {sizeLine(inches(size))}.
        </p>
      {/if}
    {/if}
  </div>
</section>

<style>
  .fit {
    display: flex; gap: var(--s4); align-items: center; margin-top: var(--s3);
    padding: var(--s3) var(--s4); border: 1px solid var(--line); border-radius: var(--r-card);
    background: var(--paper);
  }
  .fit.ok { border-color: color-mix(in oklch, var(--ok) 45%, var(--line)); }
  .fit.warn {
    border-color: color-mix(in oklch, var(--accent) 55%, var(--line));
    background: color-mix(in oklch, var(--accent) 10%, var(--paper));
  }
  .plan { flex: none; width: 84px; height: 72px; overflow: visible; }
  .bed { fill: var(--sunk); stroke: var(--field-line); stroke-width: 1; }
  .model { fill: color-mix(in oklch, var(--ok) 70%, var(--paper)); stroke: var(--ok); stroke-width: 1; }
  .warn .model {
    fill: color-mix(in oklch, var(--accent) 55%, var(--paper)); stroke: var(--live);
  }
  .words { display: grid; gap: 2px; min-width: 0; }
  .label {
    font: 500 var(--fs-label) var(--mono); letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--muted);
  }
  .dims { font: 600 17px var(--mono); letter-spacing: -0.01em; }
  p { margin: 2px 0 0; color: var(--ink); font-size: 14px; line-height: 1.4; }
  .quiet p, .hint { color: var(--muted); }
  .hint { font-size: 13px; }
</style>
