<script lang="ts">
  import { onMount } from "svelte";
  import { resolveTheme, theme } from "#lib/preferences.js";

  const os = matchMedia("(prefers-color-scheme: dark)");
  let osDark = os.matches;
  const syncOs = () => (osDark = os.matches);
  onMount(() => {
    os.addEventListener("change", syncOs);
    return () => os.removeEventListener("change", syncOs);
  });
  $: dark = resolveTheme($theme, osDark) === "dark";
</script>

<button class="btn ghost icon" type="button" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} on:click={() => theme.set(dark ? "light" : "dark")}>
<svg viewBox="0 0 24 24" aria-hidden="true">
  {#if dark}<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />{:else}<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />{/if}
</svg>
</button>

<style>
  svg { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
  .icon { width: 40px; padding: 0; }
</style>
