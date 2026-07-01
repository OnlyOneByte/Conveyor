# Conveyor

Self-hosted, pluggable **generate → slice → print** pipeline. Pick something to make,
see it render instantly, send it to a printer — no slicer knowledge required.

## Docs

- `SPEC.md` — product spec & milestones
- `docs/PLUGINS.md` — stage contracts (Generator / Slicer / Transport)
- `docs/SEQUENCE.md` — a job's trip through the pipeline
- `docs/DATA-MODEL.md` — persistence (SQLite + Redis) & storage choice
- `docs/adr/0001-plugin-isolation.md` — in-process adapters, isolated engines
- `docs/adr/0002-dual-model-preview.md` — client procedural preview + server exact model

## Layout

```
packages/  shared · api · worker · web
plugins/   generators/* · slicers/* · transports/*
profiles/  locked slicer profiles (admin-managed; secrets gitignored)
scad/      gridfinity-rebuilt-openscad (git submodule)
data/      job artifacts + sqlite db (gitignored)
```

## Toolchain

**Bun** is both package manager and runtime — it runs the TypeScript directly, so
there is no `tsc` build step and no `dist/`. `mise.toml` pins bun + Node 20.

```bash
bun install
bun run typecheck      # tsc --noEmit across the workspace
docker compose up --build
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

Tags: `:X.Y.Z`, `:X.Y`, `:latest`, and `:sha-<short>`. To cut a release:

```bash
git tag v0.1.0 && git push origin v0.1.0     # triggers build + publish
```

A deploy `compose.yml` can then swap the `build:` blocks for `image:` pins — e.g.
`image: ghcr.io/onlyonebyte/conveyor-worker:latest` — to pull instead of build.

> **Status.** M0 (contracts + skeleton) is **verified**: typechecks clean and the full
> queue → worker → status-WS pipeline runs end-to-end in stub mode (gridfinity → slicer →
> moonraker/elegoo, live progress events). M1 (real worker image) is **verified green** on
> aarch64: OpenSCAD generates real STLs and **both** slicers — PrusaSlicer (default) and
> OrcaSlicer (v2.4.1 aarch64 AppImage) — slice headless; full generate→slice E2E proven in
> the worker image. See `docs/M1-WORKER-ENGINES.md`.
