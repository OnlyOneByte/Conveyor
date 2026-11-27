<script lang="ts">
  import { onMount } from "svelte";
  import { fetchJobHistory } from "#lib/api.js";
  import { shortcuts } from "#lib/app-shortcuts.js";
  import { loadCatalog } from "#lib/catalog.js";
  import type { Command } from "#lib/commands.js";
  import { theme } from "#lib/preferences.js";
  import { toasts } from "#lib/ui/behaviour.js";
  import { goto } from "$app/navigation";
  import CommandMenu from "./CommandMenu.svelte";

  let menu = false;
  let sheet = false;
  let failed = false;
  let commands: Command[] = [];
  let rare: Promise<typeof import("./rare.js")> | null = null;
  let List: typeof import("./CommandList.svelte").default | null = null;
  let Sheet: typeof import("./ShortcutSheet.svelte").default | null = null;
  const load = () => {
    rare ??= import("./rare.js").then((mod) => {
      List = mod.CommandList;
      return mod;
    });
    return rare.catch((error: unknown) => {
      rare = null;
      throw error;
    });
  };
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  const toggleTheme = () =>
    theme.set(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  const actions: Command[] = [
    { group: "Actions", label: "New print", hint: "N", run: () => goto("/") },
    { group: "Actions", label: "Go to Make", hint: "G M", run: () => goto("/") },
    { group: "Actions", label: "Go to Jobs", hint: "G J", run: () => goto("/jobs") },
    { group: "Actions", label: "Go to Printers", hint: "G P", run: () => goto("/printers") },
    { group: "Actions", label: "Switch theme", hint: "T", run: toggleTheme },
    { group: "Actions", label: "Keyboard shortcuts", hint: "?", run: () => void openSheet() },
  ];

  async function openSheet() {
    try {
      Sheet = (await load()).ShortcutSheet;
      sheet = true;
    } catch {
      toasts.show("Shortcuts didn't load. Reload the page to try again.");
    }
  }

  async function openMenu() {
    commands = actions;
    menu = true;
    failed = false;
    const data = Promise.allSettled([fetchJobHistory(), loadCatalog()]);
    let mod: typeof import("./rare.js");
    try {
      mod = await load();
    } catch {
      failed = true;
      return;
    }
    const [jobs, catalog] = await data;
    const { jobCommands, printerCommands } = mod;
    const known = catalog.status === "fulfilled" ? catalog.value : null;
    const recent = jobs.status === "fulfilled" ? jobs.value : [];
    commands = [
      ...jobCommands(recent, known, (id) => goto(`/jobs/${id}`)),
      ...actions,
      ...printerCommands(known?.printers ?? [], () => goto("/printers")),
    ];
  }

  onMount(() => {
    const off = [
      shortcuts.register("mod+k", openMenu),
      ...actions.map(({ hint, run }) => shortcuts.register(hint.toLowerCase(), run)),
    ];
    const listen = (event: KeyboardEvent) => {
      if (!menu && !document.querySelector("dialog[open]") && shortcuts.handle(event))
        event.preventDefault();
    };
    window.addEventListener("keydown", listen);
    const warm = () => void load().catch(() => {});
    if ("requestIdleCallback" in window) requestIdleCallback(warm);
    else setTimeout(warm, 1000);
    return () => {
      for (const unregister of off) unregister();
      window.removeEventListener("keydown", listen);
    };
  });
</script>

<button type="button" class="cmdk" on:click={openMenu}>
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" /><path d="m20 20-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
  <span class="word">Search</span><span class="sr"> jobs, printers and actions</span> <kbd>{mac ? "⌘K" : "Ctrl K"}</kbd>
</button>
<CommandMenu bind:open={menu} {commands} {List} {failed} />
{#if Sheet}<svelte:component this={Sheet} bind:open={sheet} />{/if}

<style>
  .cmdk { display: flex; align-items: center; gap: var(--s2); align-self: center; width: 240px; min-height: 40px; padding: 0 var(--s2) 0 var(--s3); border: 1px solid var(--line); border-radius: var(--r-control); background: var(--paper); color: var(--muted); }
  .cmdk kbd { margin-left: auto; }
  @media (max-width: 759px) { .cmdk { width: var(--tap); min-height: var(--tap); padding: 0; justify-content: center; } .word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); } .cmdk kbd { display: none; } }
</style>
