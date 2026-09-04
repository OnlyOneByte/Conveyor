# Conveyor — Spec v0 (working title)

> Self-hosted, web-based, **pluggable** manufacturing pipeline for 3D printing.
> Pick something to make → see it render instantly → send it to a printer. No slicer knowledge required.

## 1. What it is

A PWA + self-hosted backend that turns a parameter form into a finished print. Everything
between "configure" and "printing" is automated. The interesting part is that all three
heavy stages are **pluggable** behind stable contracts:

```
Generate ──▶ Slice ──▶ Transport (print)
 (model)     (gcode)     (to printer)
```

Gridfinity is just the **default generator**. Orca is just the **default slicer**.
Klipper + Elegoo are just the **first transports**. None of them are baked into the name or core.

## 2. Vocabulary

- **Stage** — one of the three pluggable seams: `Generator`, `Slicer`, `Transport`.
- **Plugin** — a concrete implementation of a stage (`gridfinity`, `orca`, `moonraker`, `elegoo`).
- **Printer** — a physical machine, owned by a transport (its `address` plus any secrets), optionally carrying an allowlist of the generators it will accept.
- **Profile** — a slicer settings bundle, owned by a slicer, declaring the g-code flavour it emits.
  A job names one printer and one profile; the transport comes from the printer and the slicer from
  the profile, so the pair is all the configuration a print needs. Orca profiles ship as a bundled
  `/profiles` default whose raw `machine`/`process`/`filament` JSON the operator can edit in Settings
  (the edit lives in SQLite; the bundle is the reset target). (Until 2026-09-02 these were
  bound together as an operator-curated **Station**. It was always fully derivable from the two ids,
  so it only added a catalog object to curate — see docs/DATA-MODEL.md.)
- **Job** — one trip through the pipeline: `{generator + params} → {slicer + profile} → {transport + printer}`.
- **Registry** — startup-populated map of available plugins per stage.

## 3. The three stages

| Stage | Job | Default | Also planned | Boundary it wraps |
|---|---|---|---|---|
| **Generator** | params → 3D model | `gridfinity` | passthrough (upload STL), parametric box, nameplate | OpenSCAD headless / mesh libs |
| **Slicer** | model + profile → gcode | `orca` | PrusaSlicer CLI, CuraEngine, Slic3r | slicer CLI (+ xvfb where needed) |
| **Transport** | gcode + printer → live print | `moonraker` (Klipper), `elegoo` | Bambu (MQTT), PrusaLink, OctoPrint | printer HTTP/MQTT API |

Anything with a CLI can become a slicer. Anything with an upload+start API can become a transport.

## 4. Plugin model

- Every plugin ships a **manifest** (`id`, `name`, `version`, `capabilities`) and self-registers into its stage registry at startup.
- Plugins are thin **in-process TypeScript adapters** that wrap external tools (OpenSCAD, Orca CLI, Moonraker HTTP, Elegoo). Process isolation already happens naturally at the tool boundary, so adding a CLI slicer ≈ writing one adapter file.
- A generator declares a **param schema** (Zod → JSON Schema). The PWA renders its config form **dynamically** from that schema — zero per-generator UI code.
- Stages negotiate via **capabilities**: a generator's output format must be in the slicer's accepted inputs; the slicer profile's gcode flavor must be in the transport's accepted flavors. The orchestrator validates a Job's stage compatibility before it is enqueued.
- Contracts live in the `shared` package — the single source of truth imported by web, api, and worker.

See `docs/PLUGINS.md` for the full interface definitions.

## 5. Wicked-fast preview (dual-model)

The render must feel instant, so we never round-trip the real model on a slider drag:

- **Live preview** — client-side *procedural* geometry (Threlte / Three.js) assembled from the current params. Sub-millisecond on every change. A generator optionally ships a `preview` descriptor telling the client how to draw it.
- **Exact model** — generated server-side **only** at slice time. Optionally swapped into the viewport once the worker returns it ("preview now, exact in a moment").

## 6. Architecture

- **pnpm monorepo**, TypeScript end-to-end so the `Job`/param contracts are shared verbatim.
- Services: `web` (SvelteKit PWA) · `api` (REST + WebSocket) · `worker` (runs the stages) · `redis` (BullMQ queue + status pubsub).
- `docker-compose`, **Caddy** for auto-HTTPS (PWA service workers require it).
- Job state streamed to the PWA over WS: `queued → generating → slicing → transferring → printing → done | failed | canceled`.

```
packages/  shared · web · api · worker
plugins/   generators/* · slicers/* · transports/*
profiles/  locked slicer profiles (operator-managed)
scad/      gridfinity-rebuilt-openscad (submodule)
data/      job artifacts (*.stl, *.gcode) — mounted volume
```

## 7. v1 scope

- Generators: **Gridfinity** + **Upload STL** (`passthrough`) + a Generator SDK & registry.
- Slicers: **Orca** (default); pluggability proven by a 2nd adapter (PrusaSlicer CLI).
- Transports: **Klipper/Moonraker** + **ElegooLink** (the printers on hand).
- Operator: register printers and upload locked profiles (in Settings).
- User flow: pick generator *or upload an STL* → configure w/ live preview (procedural or real mesh) → pick a printer + profile → print → watch live status.
- PWA: installable, works on phone.

## 8. Non-goals (v1)

- ~~Arbitrary user STL upload~~ — PROMOTED to v1 (2026-06-29) as the `passthrough` generator + real-mesh viewport (three STLLoader). See §7.
- Multi-plate / multi-material orchestration.
- Accounts beyond a shared friends-only auth.
- Cloud printer modes (e.g. Bambu cloud) — LAN first.

## 9. Open decisions

- [x] **Name** — RESOLVED: **Conveyor** (confirmed 2026-06-29). The Stages vocabulary fits the metaphor.
- [x] **Plugin isolation** — RESOLVED: in-process TS adapters, engines isolated at the tool boundary (subprocess/HTTP). Out-of-process is an additive future option. See `docs/adr/0001-plugin-isolation.md`.
- [x] **Persistence** — RESOLVED: SQLite (durable config + job history) + Redis (live state/pubsub) + FS (artifacts). See `docs/DATA-MODEL.md`.
- [x] **Preview** — RESOLVED: dual-model — client procedural preview + server exact model. See `docs/adr/0002-dual-model-preview.md`.
- [x] **Profiles** — RESOLVED (2026-09-03): **edit the raw Orca JSON in Settings.** A profile's `machine`/`process`/`filament` JSON is editable directly in the Settings page (raw text, one tab each), not a curated per-setting UI. Bundled `/profiles` files are the read-only defaults and the reset target; edits are stored in SQLite (`orca_{machine,process,filament}_json` on `profiles`) and materialized to a per-job dir at slice time. The server validates on save (client `JSON.parse` is UX only). Prusa INI profiles stay read-only in this version. See `docs/DATA-MODEL.md`.
- [x] **Auth** — RESOLVED (2026-06-29): **shared password + HMAC-signed session cookie** (Auth A). Opt-in via `CONVEYOR_PASSWORD` (off = open for trusted-LAN/dev). **One access tier** — holding the password grants the whole app, `/catalog/*` and `/jobs-history` included. (A second `CONVEYOR_ADMIN_PASSWORD` granting an elevated role was removed 2026-09-02: with only `CONVEYOR_PASSWORD` set, no password could ever grant that role, so those two surfaces returned 403 to everyone with no diagnostic.) Cookie attrs per ARCC Secure Cookie Handling: HttpOnly, Secure, SameSite=Strict, Path=/, 12h. See `packages/api/src/auth.ts`.
- [ ] **Elegoo API** — confirm the local control protocol (SDCP / ElegooLink) via a discovery spike.

## 10. Milestones

- **M0 — Contracts & skeleton.** ✅ monorepo, `shared` schema, stage registries, compose topology.
- **M1 — Worker spike.** ✅ VERIFIED. Generator (real gridfinity STL, correct dims, params fixed, SCAD vendored, nightly OpenSCAD) **and both slicers** — PrusaSlicer (apt, default) **and** OrcaSlicer (v2.4.1 aarch64 AppImage, `--slice 0` → 449 KB/100-layer gcode) — all slice headless on aarch64; full generate→slice E2E proven in the worker image. See `docs/M1-WORKER-ENGINES.md`.
- **M2 — Transport.** 🟡 Moonraker submit/status/cancel + ElegooLink SDCP (discover/submit/status/cancel) all **written** against the protocols; verified in stub mode, awaiting hardware. See `docs/M2-TRANSPORTS.md`.
- **M3 — PWA.** ✅ dynamic generator form + Threlte live preview + STL upload (real mesh) + printer/profile picker + WS job status; 3-zone responsive layout.
- **M4 — Settings & auth.** ✅ SQLite store (bun:sqlite) + job history + a Settings page (printers/profiles CRUD) + shared-password auth (HMAC cookie, single tier).
- **M5 — Observability & convenience.** ✅ (2026-09-04) Raw Orca JSON profile editor (`v0.1.2`); a `/monitor` tab (live active jobs with per-stage timings + cancel, per-printer TCP reachability, auto-refresh); `/history` state-filter chips + text filter + auto-refresh; job-detail STL/gcode downloads, a per-stage timings section, and a Run again button. API: `GET /jobs/active`, `GET /catalog/printers/:id/reachable`, `GET /jobs/:id/artifact/:kind` (containment-guarded). Shipped in `v0.1.3`.
- **M6 — Prusa INI editing.** ✅ (2026-09-04) Prusa `config.ini` is editable in Settings alongside Orca JSON. The editable-content contract is format-tagged (`slicerFormat()` → `orca-json` | `prusa-ini`); a shared INI validator, a nullable `prusa_ini` column, format-aware content routes, worker materialization (per-job `config.ini`, 0700/0600), and a single-document Settings editor. Verified with a real PrusaSlicer slice of an edited config (`layer_height` propagated to gcode). Same SAX-04/SAX-10 discipline as the Orca editor.

## 11. Deferred / backlog

- **Hardware transport verification** — Moonraker and ElegooLink SDCP are protocol-complete but unproven against a physical printer (see M2 and the Elegoo open decision). The Elegoo adapter has two flagged VERIFY-ON-HARDWARE points (file-upload route, START_PRINT payload) that only a packet capture against a real device can resolve. `docs/M2-TRANSPORTS.md` holds the runbook.
- **History paging past 200** — `/history` filters client-side over the API's max window (`limit=200`); a deeper archive would need a server-side cursor on `GET /jobs-history`.
