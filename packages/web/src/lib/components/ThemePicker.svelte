<script lang="ts">
  import { theme, toTheme } from "#lib/preferences.js";

  const choices = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];
</script>

<fieldset>
  <legend>Theme</legend>
  <div class="seg">
    {#each choices as choice (choice.value)}
      <label>
        <input
          type="radio"
          name="theme"
          value={choice.value}
          checked={$theme === choice.value}
          on:change={() => theme.set(toTheme(choice.value))}
        />
        {choice.label}
      </label>
    {/each}
  </div>
</fieldset>

<style>
  fieldset { display: grid; gap: var(--s1); margin: 0; padding: 0; border: 0; }
  legend { padding: 0 0 var(--s1); font-weight: 650; }
  .seg {
    display: inline-flex; justify-self: start; gap: 4px; padding: 4px;
    border: 1.5px solid var(--field-line); border-radius: 15px; background: var(--sunk);
  }
  label {
    display: flex; align-items: center; min-height: 36px; padding: 0 var(--s3); border-radius: 11px;
    color: var(--muted); font-weight: 600; cursor: pointer;
  }
  label:has(:checked) { background: var(--ink); color: var(--bg); }
  label:has(:focus-visible) { outline: 3px solid var(--focus); outline-offset: 2px; }
  input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
  @media (pointer: coarse) { label { min-height: var(--tap); } }
</style>
