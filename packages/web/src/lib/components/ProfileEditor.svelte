<script lang="ts">
  import type { CatalogProfile } from "#lib/api.js";
  import { describe, fileLabel, problemOf } from "#lib/profile-check.js";
  import * as editing from "#lib/profile-content.js";
  import { couldnt } from "#lib/said.js";
  import { toasts, uid } from "#lib/ui/behaviour.js";
  import { beforeNavigate, goto } from "$app/navigation";
  import CodeEditor from "./CodeEditor.svelte";
  import Confirm from "./Confirm.svelte";
  import EditorBar from "./EditorBar.svelte";
  import FileTabs from "./FileTabs.svelte";

  export let profile: CatalogProfile;
  export let content: editing.Content;

  let [docs, saved] = [{ ...content.docs }, { ...content.docs }];
  let edited = content.edited;
  let file = content.files[0] ?? "";
  let [busy, discarding, letGo, ready] = [false, false, false, false];
  let [failure, leaving, version]: [string, URL | null, number] = ["", null, 0];
  const [errorId, panelId] = [uid("editor-error"), uid("editor-panel")];
  const tabbed = content.files.length > 1;

  $: problem = problemOf(content.lang, docs);
  $: dirty = editing.changed(docs, saved);
  $: barStatus = editing.status(problem !== null, busy, dirty);
  $: label = tabbed ? `${fileLabel(file)} settings, JSON` : "Settings, config.ini";
  $: tidied = content.lang === "json" ? editing.formatted(docs[file] ?? "") : null;
  $: can = editing.gate({ ready, problem: problem !== null, dirty, busy, tidied: tidied !== null });

  function diagnose(text: string) {
    const found = problemOf(content.lang, { ...docs, [file]: text });
    return found?.file === file ? { line: found.line, message: found.text } : null;
  }

  beforeNavigate((nav) => {
    if (letGo || !dirty) return;
    nav.cancel();
    if (nav.type === "leave" || !nav.to) return;
    [leaving, discarding] = [nav.to.url, true];
  });

  async function attempt(work: () => Promise<void>, what: string, allowed = true) {
    if (!allowed) return;
    [busy, failure] = [true, ""];
    failure = await work()
      .then(() => "")
      .catch((e: unknown) => couldnt(what, e));
    busy = false;
  }

  async function save() {
    if (!can.save) return;
    await attempt(async () => {
      await editing.saveContent(profile, content.lang, docs);
      [saved, edited] = [{ ...docs }, true];
      toasts.show(`Saved ${profile.name}`);
    }, "save your changes");
  }

  const reset = () =>
    attempt(
      async () => {
        await editing.resetContent(profile);
        const fresh = await editing.loadContent(profile);
        if (fresh) [docs, saved, edited] = [{ ...fresh.docs }, { ...fresh.docs }, fresh.edited];
        version += 1;
        toasts.show(`Reset ${profile.name}`);
      },
      `reset ${profile.name}`,
      can.reset,
    );

  function tidy() {
    if (can.tidy && tidied !== null) [docs, version] = [{ ...docs, [file]: tidied }, version + 1];
  }

  function leave() {
    [letGo, discarding] = [true, false];
    if (leaving) void goto(leaving);
  }

  function keys(event: KeyboardEvent) {
    if (event.key !== "s" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    void save();
  }
</script>

<svelte:window on:keydown={keys} />

{#if tabbed}
  <FileTabs
    files={content.files}
    bind:current={file}
    panel={panelId}
    flagged={problem?.file ?? null}
  />
{/if}
<p id={errorId} class="problem" class:shown={problem} aria-live="polite">
  {#if problem}
    {describe(problem)}
    {#if problem.file !== file}
      {@const other = problem.file}
      <button class="btn" type="button" on:click={() => (file = other)}>
        Show {fileLabel(other)}
      </button>
    {/if}
  {/if}
</p>
{#if failure}<p class="problem shown" role="alert">{failure}</p>{/if}
<div id={panelId} role={tabbed ? "tabpanel" : undefined} aria-label={fileLabel(file)}>
  <CodeEditor
    file="{file}:{version}"
    text={docs[file] ?? ""}
    lang={content.lang}
    {label}
    described={errorId}
    invalid={problem?.file === file}
    {diagnose} bind:ready
    change={(text) => (docs = { ...docs, [file]: text })}
  />
</div>

<EditorBar
  name={profile.name}
  status={barStatus}
  busy={!can.reset}
  {edited}
  canSave={can.save}
  tidy={content.lang === "json" ? can.tidy ? tidy : null : undefined}
  {save}
  {reset}
/>

<Confirm
  bind:open={discarding}
  title="Leave without saving?"
  keep="Keep editing"
  go="Discard changes"
  run={leave}
>
  <p>Your changes to {profile.name} aren't saved yet.</p>
</Confirm>

<style>
  p { margin: 0; }
  .problem { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s3); color: var(--err); overflow-wrap: anywhere; }
  .problem.shown { margin: var(--s3) 0; font-weight: 600; }
</style>
