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
- **Station** — an admin-curated binding of *a physical printer (transport + target)* to *a slicer + locked profile*. End users pick a Station; every slicing/printer detail is preset for them.
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
profiles/  locked slicer profiles (admin-managed)
scad/      gridfinity-rebuilt-openscad (submodule)
data/      job artifacts (*.stl, *.gcode) — mounted volume
```

## 7. v1 scope

- Generators: **Gridfinity** + **Upload STL** (`passthrough`) + a Generator SDK & registry.
- Slicers: **Orca** (default); pluggability proven by a 2nd adapter (PrusaSlicer CLI).
- Transports: **Klipper/Moonraker** + **ElegooLink** (the printers on hand).
- Admin: define Stations, upload locked profiles.
- User flow: pick generator *or upload an STL* → configure w/ live preview (procedural or real mesh) → pick Station → print → watch live status.
- PWA: installable, works on phone.

## 8. Non-goals (v1)

- ~~Arbitrary user STL upload~~ — PROMOTED to v1 (2026-06-29) as the `passthrough` generator + real-mesh viewport (three STLLoader). See §7.
- Multi-plate / multi-material orchestration.
- Accounts beyond a shared friends-only auth.
- Cloud printer modes (e.g. Bambu cloud) — LAN first.

## 9. Open decisions

- [x] **Name** — RESOLVED: **Conveyor** (confirmed 2026-06-29). Stations + Stages vocabulary fits the metaphor.
- [x] **Plugin isolation** — RESOLVED: in-process TS adapters, engines isolated at the tool boundary (subprocess/HTTP). Out-of-process is an additive future option. See `docs/adr/0001-plugin-isolation.md`.
- [x] **Persistence** — RESOLVED: SQLite (durable config + job history) + Redis (live state/pubsub) + FS (artifacts). See `docs/DATA-MODEL.md`.
- [x] **Preview** — RESOLVED: dual-model — client procedural preview + server exact model. See `docs/adr/0002-dual-model-preview.md`.
- [ ] **Profiles** — hand-authored JSON vs. a small admin UI.
- [x] **Auth** — RESOLVED (2026-06-29): **shared password + HMAC-signed session cookie** (Auth A). Opt-in via `CONVEYOR_PASSWORD` (off = open for trusted-LAN/dev); optional `CONVEYOR_ADMIN_PASSWORD` gates `/admin/*` + `/jobs-history` with an elevated role. Cookie attrs per ARCC Secure Cookie Handling: HttpOnly, Secure, SameSite=Strict, Path=/, 12h. See `packages/api/src/auth.ts`.
- [ ] **Elegoo API** — confirm the local control protocol (SDCP / ElegooLink) via a discovery spike.

## 10. Milestones

- **M0 — Contracts & skeleton.** ✅ monorepo, `shared` schema, stage registries, compose topology.
- **M1 — Worker spike.** ✅ VERIFIED. Generator (real gridfinity STL, correct dims, params fixed, SCAD vendored, nightly OpenSCAD) **and both slicers** — PrusaSlicer (apt, default) **and** OrcaSlicer (v2.4.1 aarch64 AppImage, `--slice 0` → 449 KB/100-layer gcode) — all slice headless on aarch64; full generate→slice E2E proven in the worker image. See `docs/M1-WORKER-ENGINES.md`.
- **M2 — Transport.** 🟡 Moonraker submit/status/cancel + ElegooLink SDCP (discover/submit/status/cancel) all **written** against the protocols; verified in stub mode, awaiting hardware. See `docs/M2-TRANSPORTS.md`.
- **M3 — PWA.** ✅ dynamic generator form + Threlte live preview + STL upload (real mesh) + Station picker + WS job status; 3-zone responsive layout.
- **M4 — Admin & auth.** ✅ SQLite store (bun:sqlite) + job history + admin panel (stations/profiles/printers CRUD) + shared-password auth (HMAC cookie, admin role).
