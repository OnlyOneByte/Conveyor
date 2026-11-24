<script lang="ts">
  import { onMount } from "svelte";
  import {
    fetchCatalogProfiles,
    fetchOrcaProfileContent,
    saveOrcaProfileContent,
    resetOrcaProfileContent,
    fetchPrusaProfileContent,
    savePrusaProfileContent,
    resetPrusaProfileContent,
    deleteProfile,
    saveProfile,
    type CatalogProfile,
    type OrcaProfileContent,
    type PrusaProfileContent,
  } from "#lib/api.js";
  import { slicerFormat } from "@conveyor/shared";
  import { spinPreview, prefersReducedMotion } from "#lib/preferences.js";
  import ThemePicker from "#lib/components/ThemePicker.svelte";

  const reducedMotion = prefersReducedMotion();

  let profiles: CatalogProfile[] = [];
  let error: string | null = null;
  let loaded = false;

  async function reload() {
    try {
      profiles = await fetchCatalogProfiles();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loaded = true;
    }
  }
  onMount(() => {
    void reload();
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (!profileEditorDirty && !prusaEditorDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnUnsaved);
    return () => window.removeEventListener("beforeunload", warnUnsaved);
  });

  async function removeProfile(id: string) {
    if (!confirm(`Delete profile "${id}"?`)) return;
    try {
      await deleteProfile(id);
      if (editingProfile?.id === id) resetProfileEditor();
      if (editingPrusa?.id === id) resetPrusaEditor();
      await reload();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  // ── Raw Orca JSON editor ──────────────────────────────────────────────────
  const ORCA_DOCUMENT_NAMES = ["machine", "process", "filament"] as const;
  type OrcaDocumentName = (typeof ORCA_DOCUMENT_NAMES)[number];
  type OrcaDocuments = OrcaProfileContent["documents"];
  const emptyOrcaDocuments = (): OrcaDocuments => ({ machine: "", process: "", filament: "" });

  let editingProfile: CatalogProfile | null = null;
  let profileContentSource: OrcaProfileContent["source"] | null = null;
  let activeDocument: OrcaDocumentName = "machine";
  let profileDocuments: OrcaDocuments = emptyOrcaDocuments();
  let originalProfileDocuments: OrcaDocuments = emptyOrcaDocuments();
  let profileEditorBusy = false;
  let profileEditorError: string | null = null;

  $: profileEditorDirty =
    editingProfile !== null &&
    ORCA_DOCUMENT_NAMES.some((name) => profileDocuments[name] !== originalProfileDocuments[name]);

  function resetProfileEditor() {
    editingProfile = null;
    profileContentSource = null;
    activeDocument = "machine";
    profileDocuments = emptyOrcaDocuments();
    originalProfileDocuments = emptyOrcaDocuments();
    profileEditorBusy = false;
    profileEditorError = null;
  }

  function parseEditorDocument(name: OrcaDocumentName, text: string): unknown {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      let message = (error as Error).message;
      if (!/line\s+\d+/i.test(message)) {
        const position = message.match(/position\s+(\d+)/i);
        if (position) {
          const offset = Number(position[1]);
          const before = text.slice(0, offset);
          const line = before.split("\n").length;
          const column = offset - before.lastIndexOf("\n");
          message += ` (line ${line}, column ${column})`;
        }
      }
      throw new Error(`${name}.json: ${message}`);
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${name}.json must contain a JSON object`);
    }
    const declaredType = (value as Record<string, unknown>).type;
    if (declaredType !== undefined && declaredType !== name) {
      throw new Error(
        `${name}.json has type ${JSON.stringify(declaredType)}; expected ${JSON.stringify(name)}`,
      );
    }
    return value;
  }

  function validateEditorDocuments(): void {
    for (const name of ORCA_DOCUMENT_NAMES) parseEditorDocument(name, profileDocuments[name]);
  }

  function setActiveDocumentText(text: string) {
    profileDocuments = { ...profileDocuments, [activeDocument]: text };
    profileEditorError = null;
  }

  function formatActiveDocument() {
    try {
      const value = parseEditorDocument(activeDocument, profileDocuments[activeDocument]);
      profileDocuments = {
        ...profileDocuments,
        [activeDocument]: `${JSON.stringify(value, null, 2)}\n`,
      };
      profileEditorError = null;
    } catch (error) {
      profileEditorError = (error as Error).message;
    }
  }

  async function openProfileEditor(profile: CatalogProfile) {
    if (profile.slicerId !== "orca") return;
    if (profileEditorDirty && !confirm("Discard unsaved profile JSON changes?")) return;

    editingProfile = profile;
    profileContentSource = null;
    activeDocument = "machine";
    profileDocuments = emptyOrcaDocuments();
    originalProfileDocuments = emptyOrcaDocuments();
    profileEditorError = null;
    profileEditorBusy = true;
    try {
      const content = await fetchOrcaProfileContent(profile.id);
      profileContentSource = content.source;
      profileDocuments = { ...content.documents };
      originalProfileDocuments = { ...content.documents };
    } catch (error) {
      profileEditorError = (error as Error).message;
    } finally {
      profileEditorBusy = false;
    }
  }

  function closeProfileEditor() {
    if (profileEditorDirty && !confirm("Discard unsaved profile JSON changes?")) return;
    resetProfileEditor();
  }

  async function saveProfileDocuments() {
    if (!editingProfile) return;
    profileEditorError = null;
    try {
      validateEditorDocuments(); // UX only; the API repeats authoritative validation.
    } catch (error) {
      profileEditorError = (error as Error).message;
      return;
    }

    profileEditorBusy = true;
    try {
      await saveOrcaProfileContent(editingProfile.id, profileDocuments);
      originalProfileDocuments = { ...profileDocuments };
      profileContentSource = "edited";
      editingProfile = { ...editingProfile, hasEditableContent: true };
      await reload();
    } catch (error) {
      profileEditorError = (error as Error).message;
    } finally {
      profileEditorBusy = false;
    }
  }

  async function resetProfileDocuments() {
    if (!editingProfile) return;
    if (!confirm(`Reset "${editingProfile.name}" to its bundled Orca JSON? Your edits will be lost.`)) return;

    profileEditorError = null;
    profileEditorBusy = true;
    try {
      await resetOrcaProfileContent(editingProfile.id);
      const content = await fetchOrcaProfileContent(editingProfile.id);
      profileContentSource = content.source;
      profileDocuments = { ...content.documents };
      originalProfileDocuments = { ...content.documents };
      editingProfile = { ...editingProfile, hasEditableContent: false };
      await reload();
    } catch (error) {
      profileEditorError = (error as Error).message;
    } finally {
      profileEditorBusy = false;
    }
  }

  // ── Raw Prusa config.ini editor ───────────────────────────────────────────
  // A Prusa profile edits ONE document (config.ini), so this editor is a single
  // textarea rather than the Orca tab set. Same open/dirty/save/reset/confirm shape.
  let editingPrusa: CatalogProfile | null = null;
  let prusaContentSource: PrusaProfileContent["source"] | null = null;
  let prusaConfig = "";
  let originalPrusaConfig = "";
  let prusaEditorBusy = false;
  let prusaEditorError: string | null = null;

  $: prusaEditorDirty = editingPrusa !== null && prusaConfig !== originalPrusaConfig;

  function resetPrusaEditor() {
    editingPrusa = null;
    prusaContentSource = null;
    prusaConfig = "";
    originalPrusaConfig = "";
    prusaEditorBusy = false;
    prusaEditorError = null;
  }

  async function openPrusaEditor(profile: CatalogProfile) {
    if (prusaEditorDirty && !confirm("Discard unsaved config.ini changes?")) return;
    editingPrusa = profile;
    prusaContentSource = null;
    prusaConfig = "";
    originalPrusaConfig = "";
    prusaEditorError = null;
    prusaEditorBusy = true;
    try {
      const content = await fetchPrusaProfileContent(profile.id);
      prusaContentSource = content.source;
      prusaConfig = content.document.config;
      originalPrusaConfig = content.document.config;
    } catch (error) {
      prusaEditorError = (error as Error).message;
    } finally {
      prusaEditorBusy = false;
    }
  }

  function closePrusaEditor() {
    if (prusaEditorDirty && !confirm("Discard unsaved config.ini changes?")) return;
    resetPrusaEditor();
  }

  async function savePrusaConfig() {
    if (!editingPrusa) return;
    prusaEditorError = null;
    prusaEditorBusy = true;
    try {
      await savePrusaProfileContent(editingPrusa.id, { config: prusaConfig });
      originalPrusaConfig = prusaConfig;
      prusaContentSource = "edited";
      editingPrusa = { ...editingPrusa, hasEditableContent: true };
      await reload();
    } catch (error) {
      prusaEditorError = (error as Error).message;
    } finally {
      prusaEditorBusy = false;
    }
  }

  async function resetPrusaConfig() {
    if (!editingPrusa) return;
    if (!confirm(`Reset "${editingPrusa.name}" to its bundled config.ini? Your edits will be lost.`)) return;
    prusaEditorError = null;
    prusaEditorBusy = true;
    try {
      await resetPrusaProfileContent(editingPrusa.id);
      const content = await fetchPrusaProfileContent(editingPrusa.id);
      prusaContentSource = content.source;
      prusaConfig = content.document.config;
      originalPrusaConfig = content.document.config;
      editingPrusa = { ...editingPrusa, hasEditableContent: false };
      await reload();
    } catch (error) {
      prusaEditorError = (error as Error).message;
    } finally {
      prusaEditorBusy = false;
    }
  }

  /** Route a row's Edit action to the editor for its slicer's format. */
  function editProfile(profile: CatalogProfile) {
    const format = slicerFormat(profile.slicerId);
    if (format === "orca-json") void openProfileEditor(profile);
    else if (format === "prusa-ini") void openPrusaEditor(profile);
  }

  // New-profile form — registers a locked slicer bundle on the /profiles mount.
  let np: CatalogProfile = { id: "", slicerId: "orca", name: "", path: "", gcodeFlavor: "klipper" };
  let npError: string | null = null;
  async function addProfile() {
    npError = null;
    try {
      await saveProfile(np);
      np = { id: "", slicerId: "orca", name: "", path: "", gcodeFlavor: "klipper" };
      await reload();
    } catch (e) {
      npError = (e as Error).message;
    }
  }
</script>

<svelte:head><title>Settings · Conveyor</title></svelte:head>
<div class="page">
  <div class="head">
    <h1>Settings</h1>
  </div>

  {#if error}<div class="card err">{error}</div>{/if}
  {#if !loaded}
    <p class="muted">Loading…</p>
  {:else}
    <section class="card">
      <h2>Preferences</h2>
      <p class="muted">How this browser displays things. Stored on this device only.</p>
      <label class="pref">
        <input
          type="checkbox"
          checked={$spinPreview}
          on:change={(e) => spinPreview.set(e.currentTarget.checked)}
        />
        <span>Spin the 3D preview automatically</span>
      </label>
      <ThemePicker />
      {#if reducedMotion}
        <p class="muted note">
          Your system is set to reduce motion, so the preview stays still even with this on.
        </p>
      {/if}
    </section>
    <section class="card">
      <h2>Profiles</h2>
      <p class="muted">Slicer bundles on the <span class="mono">/profiles</span> mount. Orca JSON and Prusa config.ini are editable here.</p>
      <div class="tablewrap"><table>
        <thead><tr><th>Name</th><th>Slicer</th><th>Flavor</th><th>Path</th><th>Source</th><th></th></tr></thead>
        <tbody>
          {#each profiles as p}
            <tr>
              <td><strong>{p.name}</strong><br /><span class="muted mono">{p.id}</span></td>
              <td class="mono">{p.slicerId}</td>
              <td class="mono">{p.gcodeFlavor}</td>
              <td class="mono">{p.path}</td>
              <td>
                {#if slicerFormat(p.slicerId)}
                  <span class="source" class:edited={p.hasEditableContent}>
                    {p.hasEditableContent ? "edited" : "bundled"}
                  </span>
                {:else}
                  <span class="source readonly">read-only</span>
                {/if}
              </td>
              <td class="actions">
                {#if slicerFormat(p.slicerId) === "orca-json"}
                  <button class="ghost small" on:click={() => editProfile(p)}>Edit JSON</button>
                {:else if slicerFormat(p.slicerId) === "prusa-ini"}
                  <button class="ghost small" on:click={() => editProfile(p)}>Edit INI</button>
                {:else}
                  <span class="muted readonly-note" title="Editing is not supported for this slicer">read-only</span>
                {/if}
                <button class="ghost small danger" on:click={() => removeProfile(p.id)}>Delete</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table></div>

      {#if editingProfile}
        <div class="profile-editor">
          <div class="editor-head">
            <div>
              <strong>Edit Orca JSON</strong>
              <div class="muted mono">{editingProfile.id}</div>
            </div>
            <div class="editor-state">
              {#if profileContentSource}
                <span class="source" class:edited={profileContentSource === "edited"}>{profileContentSource}</span>
              {/if}
              {#if profileEditorDirty}<span class="unsaved">unsaved changes</span>{/if}
            </div>
          </div>

          <div class="editor-tabs" role="tablist" aria-label="Orca profile documents">
            {#each ORCA_DOCUMENT_NAMES as name}
              <button
                type="button"
                class="tab"
                class:active={activeDocument === name}
                role="tab"
                aria-selected={activeDocument === name}
                on:click={() => (activeDocument = name)}
              >{name}.json</button>
            {/each}
          </div>

          {#if profileEditorBusy && !profileContentSource}
            <p class="muted">Loading profile JSON…</p>
          {:else}
            <textarea
              class="json-editor"
              aria-label={`${activeDocument}.json editor`}
              spellcheck="false"
              value={profileDocuments[activeDocument]}
              on:input={(event) => setActiveDocumentText(event.currentTarget.value)}
            ></textarea>
          {/if}

          {#if profileEditorError}<p class="err editor-error">{profileEditorError}</p>{/if}
          <div class="editor-actions">
            <button class="ghost" on:click={formatActiveDocument} disabled={profileEditorBusy}>Format JSON</button>
            <button class="primary" on:click={saveProfileDocuments} disabled={profileEditorBusy || !profileEditorDirty}>
              {profileEditorBusy ? "Saving…" : "Save JSON"}
            </button>
            <button class="ghost" on:click={closeProfileEditor} disabled={profileEditorBusy}>Cancel</button>
            {#if profileContentSource === "edited"}
              <button class="ghost danger reset" on:click={resetProfileDocuments} disabled={profileEditorBusy}>
                Reset to bundled version
              </button>
            {/if}
          </div>
          <p class="muted note">
            Client parsing is for immediate feedback. The API validates all three files again before saving.
          </p>
        </div>
      {/if}
      {#if editingPrusa}
        <div class="profile-editor">
          <div class="editor-head">
            <div>
              <strong>Edit config.ini</strong>
              <div class="muted mono">{editingPrusa.id}</div>
            </div>
            <div class="editor-state">
              {#if prusaContentSource}
                <span class="source" class:edited={prusaContentSource === "edited"}>{prusaContentSource}</span>
              {/if}
              {#if prusaEditorDirty}<span class="unsaved">unsaved changes</span>{/if}
            </div>
          </div>

          {#if prusaEditorBusy && !prusaContentSource}
            <p class="muted">Loading config.ini…</p>
          {:else}
            <textarea
              class="json-editor"
              aria-label="config.ini editor"
              spellcheck="false"
              value={prusaConfig}
              on:input={(event) => { prusaConfig = event.currentTarget.value; prusaEditorError = null; }}
            ></textarea>
          {/if}

          {#if prusaEditorError}<p class="err editor-error">{prusaEditorError}</p>{/if}
          <div class="editor-actions">
            <button class="primary" on:click={savePrusaConfig} disabled={prusaEditorBusy || !prusaEditorDirty}>
              {prusaEditorBusy ? "Saving…" : "Save config.ini"}
            </button>
            <button class="ghost" on:click={closePrusaEditor} disabled={prusaEditorBusy}>Cancel</button>
            {#if prusaContentSource === "edited"}
              <button class="ghost danger reset" on:click={resetPrusaConfig} disabled={prusaEditorBusy}>
                Reset to bundled version
              </button>
            {/if}
          </div>
          <p class="muted note">
            The API validates the config before saving (size + basic structure). PrusaSlicer is the
            final judge of correctness — a parseable-but-wrong config only fails when a job slices.
          </p>
        </div>
      {/if}
      <details>
        <summary><span class="caret" aria-hidden="true">▶</span>Register profile</summary>
        <div class="form">
          <label>ID<input bind:value={np.id} placeholder="orca/klipper-petg-0.2" /></label>
          <label>Name<input bind:value={np.name} placeholder="Klipper PETG 0.2mm" /></label>
          <label>Slicer<input bind:value={np.slicerId} /></label>
          <label>Gcode flavor<input bind:value={np.gcodeFlavor} placeholder="klipper" /></label>
          <label>Path<input bind:value={np.path} placeholder="/profiles/klipper-petg-0.2" /></label>
          <button class="primary" on:click={addProfile} disabled={!np.id || !np.name || !np.path}>Save profile</button>
          {#if npError}<p class="err">{npError}</p>{/if}
        </div>
      </details>
    </section>

  {/if}
</div>

<style>
  .page { display: flex; flex-direction: column; gap: 1.25rem; }
  .head { display: flex; align-items: baseline; justify-content: space-between; }
  h1 { margin: 0; }
  h2 { margin: 0 0 0.25rem; font-size: 1.1rem; }
  /* Tables carry mono ids/addresses plus an actions column, so they can exceed a
     narrow card. Without this wrapper the table overflowed the .card outright and
     the Edit/Delete buttons rendered off-screen, unreachable. */
  .tablewrap { margin-top: 0.75rem; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--border); vertical-align: top; font-size: 0.9rem; }
  th { color: var(--muted); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .mono { font-family: ui-monospace, monospace; font-size: 0.85em; }
  details { margin-top: 0.85rem; }
  /* Same disclosure affordance as SchemaForm: hide the native triangle and use one
     rotating caret, so a section no longer shows both a ▶ marker and a literal +. */
  summary { list-style: none; cursor: pointer; color: var(--live);
    display: flex; align-items: center; gap: 0.45rem; min-height: 32px; }
  summary::-webkit-details-marker { display: none; }
  .caret { font-size: 0.6rem; transition: transform 0.15s; }
  details[open] .caret { transform: rotate(90deg); }
  .form { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 0.85rem; max-width: 30rem; }
  .form label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; color: var(--muted); }
  .form input { padding: 0.45rem 0.6rem; }
  .pref { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem;
    cursor: pointer; margin-top: 0.75rem; }
  .pref input { margin: 0; }
  .note { font-size: 0.8rem; margin: 0.5rem 0 0; }
  .small { min-height: 32px; padding: 0.2rem 0.55rem; font-size: 0.8rem; }
  /* NOT display:flex — that turns the cell into a flex container and breaks table
     column sizing. nowrap keeps the two buttons on one line. */
  .source { display: inline-block; padding: 0.1rem 0.42rem; border: 1px solid var(--border);
    border-radius: 99px; color: var(--muted); font-size: 0.72rem; text-transform: uppercase;
    letter-spacing: 0.04em; }
  .source.edited { color: var(--live); border-color: var(--accent); }
  .source.readonly { text-transform: none; }
  .readonly-note { font-size: 0.72rem; vertical-align: middle; }
  .profile-editor { margin-top: 1rem; padding-top: 0.9rem; border-top: 1px solid var(--border); }
  .editor-head { display: flex; align-items: flex-start; justify-content: space-between;
    gap: 1rem; margin-bottom: 0.75rem; }
  .editor-state { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;
    justify-content: flex-end; }
  .unsaved { color: var(--live); font-size: 0.78rem; }
  .editor-tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--border); }
  .tab { border: 0; border-bottom: 2px solid transparent; border-radius: 0;
    background: transparent; color: var(--muted); padding: 0.45rem 0.65rem;
    font-family: ui-monospace, monospace; font-size: 0.78rem; }
  .tab.active { color: var(--live); border-bottom-color: var(--accent); }
  .json-editor { box-sizing: border-box; width: 100%; min-height: 28rem; margin-top: 0.65rem;
    resize: vertical; border: 1px solid var(--border); border-radius: 6px; padding: 0.7rem;
    background: var(--bg); color: var(--text); font-family: ui-monospace, monospace;
    font-size: 0.78rem; line-height: 1.45; tab-size: 2; white-space: pre; }
  .json-editor:focus { outline: 1px solid var(--focus); border-color: var(--focus); }
  .editor-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
    margin-top: 0.65rem; }
  .editor-actions .reset { margin-left: auto; }
  .editor-error { white-space: pre-wrap; margin: 0.55rem 0 0; }
  .actions { white-space: nowrap; text-align: right; }
  .actions button + button { margin-left: 0.35rem; }
  button.danger { color: var(--danger); }
  .err { color: var(--danger); }
  @media (max-width: 640px) {
    th, td { padding: 0.4rem 0.4rem; font-size: 0.82rem; }
  }
  .danger { color: var(--danger); }
</style>
