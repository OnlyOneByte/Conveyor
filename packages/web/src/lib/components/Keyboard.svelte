<script lang="ts">
  import { afterNavigate, goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { fetchJobHistory } from "#lib/api.js";
  import { loadCatalog } from "#lib/catalog.js";
  import { type Command, jobCommands, printerCommands } from "#lib/commands.js";
  import { theme } from "#lib/preferences.js";
  import { jobKeys, shortcuts } from "#lib/app-shortcuts.js";
  import CommandMenu from "./CommandMenu.svelte";
  import ShortcutSheet from "./ShortcutSheet.svelte";

  let menu = false;
  let sheet = false;
  let commands: Command[] = [];
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  const toggleTheme = () => theme.set(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  const actions: Command[] = [
    { group: "Actions", label: "New print", hint: "N", run: () => goto("/") },
    { group: "Actions", label: "Go to Make", hint: "G M", run: () => goto("/") },
    { group: "Actions", label: "Go to Jobs", hint: "G J", run: () => goto("/history") },
    { group: "Actions", label: "Go to Printers", hint: "G P", run: () => goto("/settings") },
    { group: "Actions", label: "Switch theme", hint: "T", run: toggleTheme },
    { group: "Actions", label: "Keyboard shortcuts", hint: "?", run: () => (sheet = true) },
  ];

  async function openMenu() {
    commands = actions;
    menu = true;
    const [jobs, catalog] = await Promise.allSettled([fetchJobHistory(), loadCatalog()]);
    const known = catalog.status === "fulfilled" ? catalog.value : null;
    const recent = jobs.status === "fulfilled" ? jobs.value : [];
    commands = [
      ...jobCommands(recent, known, (id) => goto(`/history/${id}`)),
      ...actions,
      ...printerCommands(known?.printers ?? [], () => goto("/settings")),
    ];
  }

  let jobs: (() => void) | undefined;
  const arm = (path: string | undefined) => {
    jobs?.();
    jobs = path === "/history" ? jobKeys() : undefined;
  };
  afterNavigate(({ to }) => arm(to?.url.pathname));

  onMount(() => {
    const off = [shortcuts.register("mod+k", openMenu), ...actions.map(({ hint, run }) => shortcuts.register(hint.toLowerCase(), run))];
    const listen = (event: KeyboardEvent) => {
      if (!document.querySelector("dialog[open]") && shortcuts.handle(event)) event.preventDefault();
    };
    window.addEventListener("keydown", listen);
    arm(location.pathname);
    return () => {
      for (const unregister of [...off, jobs ?? (() => {})]) unregister();
      window.removeEventListener("keydown", listen);
    };
  });
</script>

<button type="button" class="cmdk" on:click={openMenu}>
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" /><path d="m20 20-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
  <span class="word">Search</span><span class="sr"> jobs, printers and actions</span> <kbd>{mac ? "⌘K" : "Ctrl K"}</kbd>
</button>
<CommandMenu bind:open={menu} {commands} />
<ShortcutSheet bind:open={sheet} />

<style>
  .cmdk { display: flex; align-items: center; gap: var(--s2); align-self: center; width: 240px; min-height: 40px; padding: 0 var(--s2) 0 var(--s3); border: 1px solid var(--line); border-radius: var(--r-control); background: var(--paper); color: var(--muted); }
  .cmdk kbd { margin-left: auto; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  @media (max-width: 759px) { .cmdk { width: var(--tap); min-height: var(--tap); padding: 0; justify-content: center; } .word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); } .cmdk kbd { display: none; } }
</style>
