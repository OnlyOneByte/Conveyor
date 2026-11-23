<script lang="ts">
  import { theme, toTheme } from "#lib/preferences.js";
</script>

<label class="pref">
  <span>Theme</span>
  <select value={$theme} on:change={(e) => theme.set(toTheme(e.currentTarget.value))}>
    <option value="system">Match the system</option>
    <option value="light">Light</option>
    <option value="dark">Dark</option>
  </select>
</label>

<style>
  .pref { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; margin-top: 0.75rem; }
</style>
