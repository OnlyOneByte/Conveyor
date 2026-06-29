# ADR 0002 — Dual-model preview (client procedural + server exact)

- **Status:** Accepted
- **Date:** 2026-06-29
- **Context stage:** M0 (informs M3 PWA)

## Context

The PWA must feel "wicked fast" — the box should rebuild the instant a user drags a
slider. There are three ways to render a preview:

1. **Round-trip the real model.** Every param change calls the server → OpenSCAD →
   STL → download → render. Correct, but multi-second latency per change. A non-starter
   for an interactive form.
2. **WASM the generator in the browser.** Run OpenSCAD-in-WASM client-side. Accurate and
   offline, but a heavy download, slow cold start, and a generator-specific toolchain —
   it couples the fast path to one engine and breaks the "any generator" goal.
3. **Procedural client preview + exact server model.** Draw a faithful *visual approximation*
   in the browser from the same params, and only generate the real STL server-side at slice
   time.

Gridfinity makes option 3 especially attractive: bins are a regular 42mm grid with a known
base profile, walls, dividers, scoop, label tab, and stacking lip — all cheap to assemble
from `RoundedBoxGeometry` + a couple of extruded cross-sections. The preview never needs to
be manufacturing-exact; it needs to be *recognizable and instant*.

## Decision

**Adopt the dual-model split:**

- **Live preview — client-side, procedural.** Threlte/Three.js geometry assembled from the
  current params, rebuilt locally on every change (sub-millisecond, no network). A generator
  optionally ships a `PreviewDescriptor { kind: "procedural", module }` naming a **client
  module** that knows how to build its geometry from params. Generators without one fall back
  to a generic bounding-box preview.
- **Exact model — server-side, on demand.** The canonical STL/3MF is produced by the
  generator's `generate()` **only** when the user commits to printing (the start of the
  pipeline in ADR 0001 / SEQUENCE). Optionally, once the worker has produced it, the exact
  mesh can be streamed back and swapped into the viewport ("preview now, exact in a moment").

The **param schema is the shared contract** between the two models: the same Zod schema drives
the form, the client preview module, and the server `generate()` call. There is exactly one
source of truth for "what the user configured."

## Consequences

**Positive**
- Interaction latency is decoupled from engine speed — dragging a slider never waits on OpenSCAD.
- The fast path is engine-agnostic: a new generator gets an instant preview by shipping one
  small client module, with **zero** change to the slicer/transport stages.
- No multi-MB WASM engine in the bundle; the PWA stays light and installs fast on a phone.
- The exact model is computed exactly once, at the only moment it's truly needed (slicing).

**Negative / accepted risks**
- The preview can **drift** from the exact model — a procedural approximation is not the STL.
  Mitigation: keep previews visually honest (correct proportions/feature presence), label them
  "preview," and offer the optional exact-mesh swap after generation for users who want to verify.
- Each generator must author a preview module to look good (else the generic bounding box).
  Accepted: it's a small, isolated, client-only file and degrades gracefully.
- Two renderers conceptually exist (procedural vs. the real mesh loader). Accepted: they share
  the param schema and only the procedural one is on the hot path.

## When we'd revisit

- A generator's output is **not reasonably approximable** procedurally (highly organic/implicit
  geometry) → consider a server-rendered thumbnail or a scoped WASM preview *for that generator only*.
- Users report meaningful confusion from preview/exact drift → make the post-generation exact-mesh
  swap mandatory rather than optional.

## Implementation notes

- `PreviewDescriptor.module` is a stable id the web app maps to a client module
  (e.g. `previews/gridfinity.ts` exporting `buildGeometry(params): BufferGeometry`).
- The web app renders the generator form from `paramSchema` (JSON Schema) and feeds the *same*
  params object to the preview module — guaranteeing form and preview never disagree.
- Exact-mesh swap (optional) reuses the job status stream: when `state=slicing` begins, the
  model artifact already exists and can be offered to the viewport over the same channel.
