# Conveyor

Self-hosted, pluggable **generate → slice → print** pipeline. Pick something to make,
see it render instantly, send it to a printer — no slicer knowledge required.

## Run it

Self-hosting, from cloning to the first sign-in: [docs/self-hosting.md](docs/self-hosting.md#first-run).
Clone with `--recurse-submodules`, set a password and a signing secret in `.env`, then
`docker compose up -d --build`.

## Docs

- [docs/README.md](docs/README.md) — index of every doc page
- [docs/self-hosting.md](docs/self-hosting.md) — install, upgrade, backup and restore
- `SPEC.md` — product spec & milestones
- `docs/PLUGINS.md` — stage contracts (Generator / Slicer / Transport)
- `docs/SEQUENCE.md` — a job's trip through the pipeline
- `docs/DATA-MODEL.md` — persistence (SQLite + Redis) & storage choice
- `docs/adr/0001-plugin-isolation.md` — in-process adapters, isolated engines
- `docs/adr/0002-dual-model-preview.md` — client procedural preview + server exact model

## Layout

The repository layout is in [AGENTS.md §1](AGENTS.md#1-repository-layout-today). The directories the stack
mounts at runtime (`data/`, `profiles/`, `scad/`) are described in
[docs/self-hosting.md](docs/self-hosting.md#runtime-directories). `data/` and any `secrets*` file under
`profiles/` are gitignored.

## Toolchain

**Bun** is both package manager and runtime — it runs the TypeScript directly, so
there is no `tsc` build step and no `dist/`. `mise.toml` pins bun + Node 26.

```bash
bun install
bun run typecheck      # tsc --noEmit across the workspace
```

For a no-engines local run (stub mode — no OpenSCAD/Orca needed):

```bash
CONVEYOR_ENGINE_STUB=1 bun run dev:worker   # in one shell
CONVEYOR_ENGINE_STUB=1 bun run dev:api      # in another (needs a local redis)
```

## Container images

Prebuilt **multi-arch** (`amd64` + `arm64`) images are published to GHCR on every
`v*` tag by `.github/workflows/release.yml` (native runners per arch — no QEMU —
merged into one manifest):

- `ghcr.io/onlyonebyte/conveyor-web`
- `ghcr.io/onlyonebyte/conveyor-api`
- `ghcr.io/onlyonebyte/conveyor-worker` (bakes in OpenSCAD + PrusaSlicer/OrcaSlicer)

Tags: `:X.Y.Z`, `:X.Y`, `:latest`, and `:sha-<short>`. How a release is cut and built is in
[docs/contributing.md](docs/contributing.md#releases).

A deploy `compose.yml` can then swap the `build:` blocks for `image:` pins — e.g.
`image: ghcr.io/onlyonebyte/conveyor-worker:latest` — to pull instead of build.

## Status

Milestones M0, M1 and M3 to M6 are done: the worker image generates and slices headless with OpenSCAD,
PrusaSlicer and OrcaSlicer, and the web app covers Make, Jobs, Printers and Settings, behind a shared-password
sign-in. M2, the Moonraker and ElegooLink transports, is written and tested against stubs, and still awaits
real printers. [SPEC.md §10](SPEC.md#10-milestones) has each milestone.

## License

Conveyor — self-hosted, pluggable generate → slice → print pipeline.
Copyright (C) 2026 Rengang (Angelo) Yang.

Conveyor is free software under the GNU Affero General Public License, version 3 or (at your option) any
later version (`AGPL-3.0-or-later`); the full text is in [LICENSE](LICENSE). It comes with no warranty.

The worker image bundles third-party engines under their own licenses, among them the AGPL-3.0 slicers and
the GPL OpenSCAD. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists each one, its version, its license and
where its source is.
