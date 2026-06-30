<script lang="ts">
  import { onMount } from "svelte";
  import {
    fetchAdminStations,
    fetchAdminPrinters,
    fetchAdminProfiles,
    fetchJobHistory,
    saveStation,
    saveProfile,
    deleteStation,
    type AdminStation,
    type AdminPrinter,
    type AdminProfile,
    type JobHistoryEntry,
  } from "$lib/api";

  let stations: AdminStation[] = [];
  let printers: AdminPrinter[] = [];
  let profiles: AdminProfile[] = [];
  let history: JobHistoryEntry[] = [];
  let error: string | null = null;
  let loaded = false;

  async function reload() {
    try {
      [stations, printers, profiles, history] = await Promise.all([
        fetchAdminStations(),
        fetchAdminPrinters(),
        fetchAdminProfiles(),
        fetchJobHistory(),
      ]);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loaded = true;
    }
  }
  onMount(reload);

  // New-station form. The admin binds printer + slicer + profile → a pickable Station.
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
    const station: AdminStation = {
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

  // New-profile form — registers a locked slicer bundle on the /profiles mount.
  let np: AdminProfile = { id: "", slicerId: "orca", name: "", path: "", gcodeFlavor: "klipper" };
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

  function fmtDate(ms: number): string {
    return new Date(ms).toLocaleString();
  }
</script>

<div class="admin">
  <div class="head">
    <h1>Admin</h1>
    <a href="/" class="navlink">← Back to app</a>
  </div>

  {#if error}<div class="card err">{error}</div>{/if}
  {#if !loaded}
    <p class="muted">Loading…</p>
  {:else}
    <!-- Stations -->
    <section class="card">
      <h2>Stations</h2>
      <p class="muted">What end users pick. Each binds a printer + slicer profile.</p>
      <table>
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
      </table>

      <details>
        <summary>+ Add station</summary>
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
      <table>
        <thead><tr><th>Name</th><th>Slicer</th><th>Flavor</th><th>Path</th></tr></thead>
        <tbody>
          {#each profiles as p}
            <tr><td><strong>{p.name}</strong><br /><span class="muted mono">{p.id}</span></td><td class="mono">{p.slicerId}</td><td class="mono">{p.gcodeFlavor}</td><td class="mono">{p.path}</td></tr>
          {/each}
        </tbody>
      </table>
      <details>
        <summary>+ Register profile</summary>
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
      <table>
        <thead><tr><th>Name</th><th>Transport</th><th>Address</th><th>Secrets</th></tr></thead>
        <tbody>
          {#each printers as p}
            <tr><td><strong>{p.name}</strong><br /><span class="muted mono">{p.id}</span></td><td class="mono">{p.transportId}</td><td class="mono">{p.address}</td><td>{p.hasSecrets ? "🔒 set" : "—"}</td></tr>
          {/each}
        </tbody>
      </table>
    </section>

    <!-- Job history -->
    <section class="card">
      <h2>Recent jobs</h2>
      {#if history.length === 0}
        <p class="muted">No jobs yet.</p>
      {:else}
        <table>
          <thead><tr><th>When</th><th>Generator</th><th>Station</th><th>State</th></tr></thead>
          <tbody>
            {#each history as j}
              <tr>
                <td class="muted">{fmtDate(j.createdAt)}</td>
                <td class="mono">{j.request.generator.id}</td>
                <td class="mono">{j.request.stationId}</td>
                <td><span class="state {j.state}">{j.state}</span>{#if j.error}<br /><span class="muted">{j.error.reason}</span>{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  {/if}
</div>

<style>
  .admin { display: flex; flex-direction: column; gap: 1.25rem; }
  .head { display: flex; align-items: baseline; justify-content: space-between; }
  h1 { margin: 0; }
  h2 { margin: 0 0 0.25rem; font-size: 1.1rem; }
  .navlink { color: var(--accent); text-decoration: none; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; }
  th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--border); vertical-align: top; font-size: 0.9rem; }
  th { color: var(--muted); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .mono { font-family: ui-monospace, monospace; font-size: 0.85em; }
  details { margin-top: 0.85rem; }
  summary { cursor: pointer; color: var(--accent); }
  .form { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 0.85rem; max-width: 30rem; }
  .form label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; color: var(--muted); }
  .form input, .form select { padding: 0.45rem 0.6rem; }
  .err { color: var(--danger); }
  .danger { color: var(--danger); }
  .state { font-size: 0.8rem; padding: 0.1rem 0.45rem; border-radius: 99px; border: 1px solid var(--border); }
  .state.done { color: var(--ok); border-color: var(--ok); }
  .state.failed, .state.canceled { color: var(--danger); border-color: var(--danger); }
</style>
