<script lang="ts">
  import { onMount } from "svelte";
  import {
    fetchCatalogStations,
    fetchCatalogPrinters,
    fetchCatalogProfiles,
    fetchCatalogTransports,
    saveStation,
    savePrinter,
    deletePrinter,
    deleteProfile,
    saveProfile,
    deleteStation,
    type CatalogStation,
    type CatalogPrinter,
    type CatalogProfile,
    type CatalogTransport,
  } from "$lib/api";
  import { spinPreview, prefersReducedMotion } from "$lib/preferences";

  const reducedMotion = prefersReducedMotion();

  let stations: CatalogStation[] = [];
  let printers: CatalogPrinter[] = [];
  let profiles: CatalogProfile[] = [];
  let transports: CatalogTransport[] = [];
  let error: string | null = null;
  let loaded = false;

  async function reload() {
    try {
      [stations, printers, profiles, transports] = await Promise.all([
        fetchCatalogStations(),
        fetchCatalogPrinters(),
        fetchCatalogProfiles(),
        fetchCatalogTransports(),
      ]);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loaded = true;
    }
  }
  onMount(reload);

  // Seed the transport picker once the list arrives, without clobbering an edit.
  $: if (!ppTransportId && transports.length && !editingPrinter) ppTransportId = transports[0].id;

  // New-station form: binds printer + slicer + profile → a Station users can pick.
  // We only bind the user-chosen fields; slicerId/transportId are derived at save
  // time from the chosen profile/printer (avoids a reactive write-back cycle).
  let nsId = "";
  let nsName = "";
  let nsPrinterId = "";
  let nsProfileId = "";
  let nsError: string | null = null;

  function resetNewStation() {
    nsId = "";
    nsName = "";
    nsPrinterId = "";
    nsProfileId = "";
  }

  async function addStation() {
    nsError = null;
    const profile = profiles.find((p) => p.id === nsProfileId);
    const printer = printers.find((p) => p.id === nsPrinterId);
    if (!profile || !printer) {
      nsError = "Choose a printer and a profile.";
      return;
    }
    const station: CatalogStation = {
      id: nsId,
      name: nsName,
      transportId: printer.transportId,
      printerId: printer.id,
      slicerId: profile.slicerId, // derived → always consistent (API re-validates)
      profileId: profile.id,
    };
    try {
      await saveStation(station);
      resetNewStation();
      await reload();
    } catch (e) {
      nsError = (e as Error).message;
    }
  }

  async function removeStation(id: string) {
    if (!confirm(`Delete station "${id}"?`)) return;
    try {
      await deleteStation(id);
      await reload();
    } catch (e) {
      error = (e as Error).message;
    }
  }


  // Printer form — doubles as add and edit. `editingPrinter` holds the id being
  // edited (null = adding), because the M2 hardware flow is "change an existing
  // printer's address", not "create one".
  let editingPrinter: string | null = null;
  let ppId = "";
  let ppName = "";
  let ppTransportId = "";
  let ppAddress = "";
  let ppSecret = "";
  let ppError: string | null = null;
  let ppOpen = false;

  function resetPrinter() {
    editingPrinter = null;
    ppId = "";
    ppName = "";
    ppTransportId = transports[0]?.id ?? "";
    ppAddress = "";
    ppSecret = "";
    ppError = null;
  }

  function editPrinter(p: CatalogPrinter) {
    editingPrinter = p.id;
    ppId = p.id;
    ppName = p.name;
    ppTransportId = p.transportId;
    ppAddress = p.address;
    // Never prefilled: reads strip secrets, so there is nothing to prefill WITH.
    // Left blank the stored value is preserved server-side.
    ppSecret = "";
    ppError = null;
    ppOpen = true;
  }

  async function submitPrinter() {
    ppError = null;
    try {
      await savePrinter({
        id: ppId,
        name: ppName,
        transportId: ppTransportId,
        address: ppAddress,
        // Omit entirely when blank so the API preserves any stored secret.
        ...(ppSecret.trim() ? { secrets: { apiKey: ppSecret.trim() } } : {}),
      });
      resetPrinter();
      ppOpen = false;
      await reload();
    } catch (e) {
      ppError = (e as Error).message;
    }
  }

  // Printer/profile deletes are refused with 409 when a Station still references the
  // row; `del()` surfaces that message, so show it verbatim rather than a generic error.
  async function removePrinter(id: string) {
    if (!confirm(`Delete printer "${id}"?`)) return;
    try {
      await deletePrinter(id);
      if (editingPrinter === id) { resetPrinter(); ppOpen = false; }
      await reload();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function removeProfile(id: string) {
    if (!confirm(`Delete profile "${id}"?`)) return;
    try {
      await deleteProfile(id);
      await reload();
    } catch (e) {
      error = (e as Error).message;
    }
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

<div class="page">
  <div class="head">
    <h1>Settings</h1>
    <a href="/" class="navlink">← Back to app</a>
  </div>

  {#if error}<div class="card err">{error}</div>{/if}
  {#if !loaded}
    <p class="muted">Loading…</p>
  {:else}
    <!-- Preferences -->
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
      {#if reducedMotion}
        <p class="muted note">
          Your system is set to reduce motion, so the preview stays still even with this on.
        </p>
      {/if}
    </section>
    <!-- Stations -->
    <section class="card">
      <h2>Stations</h2>
      <p class="muted">What end users pick. Each binds a printer + slicer profile.</p>
      <div class="tablewrap"><table>
        <thead><tr><th>Name</th><th>Printer</th><th>Profile</th><th></th></tr></thead>
        <tbody>
          {#each stations as s}
            <tr>
              <td><strong>{s.name}</strong><br /><span class="muted mono">{s.id}</span></td>
              <td class="mono">{s.printerId}</td>
              <td class="mono">{s.profileId}</td>
              <td><button class="ghost danger" on:click={() => removeStation(s.id)}>Delete</button></td>
            </tr>
          {/each}
        </tbody>
      </table></div>

      <details>
        <summary><span class="caret" aria-hidden="true">▶</span>Add station</summary>
        <div class="form">
          <label>ID<input bind:value={nsId} placeholder="garage-petg" /></label>
          <label>Name<input bind:value={nsName} placeholder="Garage Klipper — PETG 0.2mm" /></label>
          <label>Printer
            <select bind:value={nsPrinterId}>
              <option value="" disabled>— choose —</option>
              {#each printers as p}<option value={p.id}>{p.name} ({p.transportId})</option>{/each}
            </select>
          </label>
          <label>Profile
            <select bind:value={nsProfileId}>
              <option value="" disabled>— choose —</option>
              {#each profiles as p}<option value={p.id}>{p.name} ({p.gcodeFlavor})</option>{/each}
            </select>
          </label>
          <button class="primary" on:click={addStation} disabled={!nsId || !nsName || !nsPrinterId || !nsProfileId}>Save station</button>
          {#if nsError}<p class="err">{nsError}</p>{/if}
        </div>
      </details>
    </section>

    <!-- Profiles -->
    <section class="card">
      <h2>Profiles</h2>
      <p class="muted">Locked slicer bundles on the <span class="mono">/profiles</span> mount.</p>
      <div class="tablewrap"><table>
        <thead><tr><th>Name</th><th>Slicer</th><th>Flavor</th><th>Path</th><th></th></tr></thead>
        <tbody>
          {#each profiles as p}
            <tr><td><strong>{p.name}</strong><br /><span class="muted mono">{p.id}</span></td><td class="mono">{p.slicerId}</td><td class="mono">{p.gcodeFlavor}</td><td class="mono">{p.path}</td><td class="actions"><button class="ghost small danger" on:click={() => removeProfile(p.id)}>Delete</button></td></tr>
          {/each}
        </tbody>
      </table></div>
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

    <!-- Printers -->
    <section class="card">
      <h2>Printers</h2>
      <p class="muted">Physical devices. Secrets are stored server-side and never shown here.</p>
      <div class="tablewrap"><table>
        <thead><tr><th>Name</th><th>Transport</th><th>Address</th><th>Secrets</th><th></th></tr></thead>
        <tbody>
          {#each printers as p}
            <tr><td><strong>{p.name}</strong><br /><span class="muted mono">{p.id}</span></td><td class="mono">{p.transportId}</td><td class="mono">{p.address}</td><td>{p.hasSecrets ? "🔒 set" : "—"}</td><td class="actions"><button class="ghost small" on:click={() => editPrinter(p)}>Edit</button><button class="ghost small danger" on:click={() => removePrinter(p.id)}>Delete</button></td></tr>
          {/each}
        </tbody>
      </table></div>

      <details bind:open={ppOpen}>
        <summary><span class="caret" aria-hidden="true">▶</span>{editingPrinter ? `Editing ${editingPrinter}` : "Add printer"}</summary>
        <div class="form">
          <label>ID
            <input bind:value={ppId} placeholder="klipper-garage" disabled={!!editingPrinter} />
          </label>
          <label>Name<input bind:value={ppName} placeholder="Garage Klipper" /></label>
          <label>Transport
            <select bind:value={ppTransportId}>
              <option value="" disabled>— choose —</option>
              {#each transports as t}<option value={t.id}>{t.name} ({t.id})</option>{/each}
            </select>
          </label>
          <label>Address
            <input bind:value={ppAddress} placeholder="192.168.1.50:7125" />
          </label>
          <label>API key / secret
            <input type="password" bind:value={ppSecret} autocomplete="off"
              placeholder={editingPrinter ? "leave blank to keep the stored secret" : "optional"} />
          </label>
          <p class="muted note">
            Secrets are write-only — they are never sent back to the browser, so this
            field always starts empty. Leaving it blank keeps whatever is stored.
          </p>
          <div class="row-actions">
            <button class="primary" on:click={submitPrinter}
              disabled={!ppId || !ppName || !ppTransportId || !ppAddress}>
              {editingPrinter ? "Save changes" : "Add printer"}
            </button>
            {#if editingPrinter}
              <button class="ghost" on:click={() => { resetPrinter(); ppOpen = false; }}>Cancel</button>
            {/if}
          </div>
          {#if ppError}<p class="err">{ppError}</p>{/if}
        </div>
      </details>
    </section>

    <!-- Job history lives on its own page now: /jobs -->
  {/if}
</div>

<style>
  .page { display: flex; flex-direction: column; gap: 1.25rem; }
  .head { display: flex; align-items: baseline; justify-content: space-between; }
  h1 { margin: 0; }
  h2 { margin: 0 0 0.25rem; font-size: 1.1rem; }
  .navlink { color: var(--accent); text-decoration: none; }
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
  summary { list-style: none; cursor: pointer; color: var(--accent);
    display: flex; align-items: center; gap: 0.45rem; min-height: 32px; }
  summary::-webkit-details-marker { display: none; }
  .caret { font-size: 0.6rem; transition: transform 0.15s; }
  details[open] .caret { transform: rotate(90deg); }
  .form { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 0.85rem; max-width: 30rem; }
  .form label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; color: var(--muted); }
  .form input, .form select { padding: 0.45rem 0.6rem; }
  .pref { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem;
    cursor: pointer; margin-top: 0.75rem; }
  .pref input { margin: 0; }
  .note { font-size: 0.8rem; margin: 0.5rem 0 0; }
  .small { min-height: 32px; padding: 0.2rem 0.55rem; font-size: 0.8rem; }
  .row-actions { display: flex; gap: 0.5rem; align-items: center; }
  /* NOT display:flex — that turns the cell into a flex container and breaks table
     column sizing. nowrap keeps the two buttons on one line. */
  .actions { white-space: nowrap; text-align: right; }
  .actions button + button { margin-left: 0.35rem; }
  button.danger { color: var(--danger); }
  .err { color: var(--danger); }
  @media (max-width: 640px) {
    th, td { padding: 0.4rem 0.4rem; font-size: 0.82rem; }
  }
  .danger { color: var(--danger); }
</style>
