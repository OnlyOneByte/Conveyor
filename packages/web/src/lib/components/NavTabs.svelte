<script lang="ts">
  import { page } from "$app/state";

  const TABS = [
    {
      href: "/",
      label: "Make",
      icon: "M12 3 4 7.5v9L12 21l8-4.5v-9L12 3ZM4 7.5l8 4.5 8-4.5M12 12v9",
      on: (p: string) => p === "/",
    },
    {
      href: "/jobs",
      label: "Jobs",
      icon: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
      on: (p: string) => p.startsWith("/jobs") || p.startsWith("/monitor"),
    },
    {
      href: "/printers",
      label: "Printers",
      icon: "M5 3h14v4H5zM3 7h18v10H3zM8 17v4h8v-4",
      on: (p: string) => p.startsWith("/printers") || p.startsWith("/settings"),
    },
  ];
</script>

<nav class="tabs" aria-label="Main">
  {#each TABS as tab (tab.href)}
    <a href={tab.href} aria-current={tab.on(page.url.pathname) ? "page" : undefined}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={tab.icon} /></svg>{tab.label}
    </a>
  {/each}
</nav>

<style>
  .tabs { display: flex; gap: var(--s1); padding: var(--s1); border-radius: 15px; background: var(--sunk); border: 1px solid var(--line); }
  .tabs a { position: relative; display: flex; align-items: center; gap: var(--s2); min-height: 38px; padding: 0 var(--s4); border-radius: 11px; font-weight: 600; color: var(--muted); text-decoration: none; white-space: nowrap; }
  @media (hover: hover) { .tabs a:hover { color: var(--ink); } }
  .tabs a[aria-current="page"] { background: var(--paper); color: var(--ink); box-shadow: var(--lift); }
  .tabs a[aria-current="page"]::after { content: ""; position: absolute; inset: auto var(--s3) 3px; height: 3px; border-radius: 2px; background: var(--live); }
  svg { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
  @media (max-width: 759px) {
    .tabs { position: fixed; z-index: 30; left: 0; right: 0; bottom: 0; height: var(--tabbar); display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; padding: var(--s2) 10px calc(var(--s2) + env(safe-area-inset-bottom)); border-radius: 0; border-width: 1px 0 0; border-color: var(--line-2); background: var(--paper); }
    .tabs a { flex-direction: column; justify-content: center; gap: 3px; min-height: 56px; padding: 0; border-radius: var(--r-card); font-size: 12.5px; }
    .tabs a[aria-current="page"] { background: var(--sunk); box-shadow: none; }
    .tabs a[aria-current="page"]::after { inset: 0 30% auto; }
    .tabs svg { width: 22px; height: 22px; }
  }
</style>
