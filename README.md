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

## Dev (M0 skeleton)

```bash
pnpm install
pnpm -r build          # builds shared → plugins → api/worker in topo order
docker compose up --build
```

> **Status: M0 — contracts + skeleton.** The worker's stage calls are stubbed
> (the real invocations are present as comments). M1 proves OpenSCAD generation +
> OrcaSlicer headless slicing in the worker image.
