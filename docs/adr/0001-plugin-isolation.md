# ADR 0001 — Plugin isolation: in-process vs out-of-process

- **Status:** Accepted
- **Date:** 2026-06-29
- **Context stage:** M0 (contracts & skeleton)

## Context

Conveyor has three pluggable stages — `Generator`, `Slicer`, `Transport`. We must decide
how a plugin runs relative to the `worker` process. Two models were on the table:

- **In-process** — each plugin is a TypeScript adapter loaded into the worker; it satisfies
  the stage interface directly and shells out to its engine as needed.
- **Out-of-process** — each plugin is its own subprocess/container speaking a wire protocol
  (stdio/HTTP/gRPC) to the worker, allowing any language and hard crash/security isolation.

The deciding observation: **the heavy, risky work already runs out-of-process.** Every real
engine — OpenSCAD, OrcaSlicer, Moonraker — is an external CLI or network API. The TS adapter
is thin glue: build args, spawn/`fetch`, parse result, map to an `Artifact`. The genuinely
dangerous code (long-running, memory-hungry, occasionally crashy) is *already* isolated at the
tool boundary regardless of how the adapter itself is loaded.

## Decision

**Adopt a two-tier model for v1:**

1. **Seam (always in-process).** A plugin is an in-process TS adapter implementing the stage
   interface from `shared`. This is the only thing the worker links against. Simple to build,
   debug, and type-check; the `Job`/`Artifact` contracts are shared verbatim — no IPC, no
   serialization tax on the glue layer.

2. **Engine (isolated at the tool boundary).** The adapter never does heavy work in the Node
   event loop. It **spawns a subprocess** (OpenSCAD, Orca under xvfb) or **calls a network API**
   (Moonraker, Elegoo). Crashes, OOMs, and hangs are contained in a child process the worker
   supervises (timeout + kill), not in the worker itself.

3. **Keep the interface engine-agnostic** so out-of-process is an *additive* future option, not
   a rewrite. An adapter that shells to a sidecar container satisfies the exact same TS
   interface as one that calls a library. The core never learns whether a plugin is in- or
   out-of-process.

In short: **in-process adapters, out-of-process engines.**

## Consequences

**Positive**
- Smallest possible surface for v1: adding a CLI slicer ≈ one adapter file.
- Shared types end-to-end; no protocol/codegen to maintain.
- Risky work is still sandboxed (subprocess timeouts/kills, network failure handling).
- A bad engine invocation fails one job, not the worker — the adapter catches and emits `StageError`.

**Negative / accepted risks**
- v1 plugins must be authored in TS (the *glue* only — the engine can be any language/binary).
- A pathological adapter (infinite loop in the glue itself, not the engine) could still block a
  worker. Mitigation: keep adapters thin; run multiple worker replicas; enforce per-stage timeouts.
- No per-plugin security sandbox at the adapter layer. Acceptable: this is a self-hosted,
  friends-only deployment, and engines run with the worker's own privileges either way.

## When we'd revisit (triggers for out-of-process)

- A desired plugin's engine has **no CLI/HTTP surface** and only ships as a non-JS library.
- We want to accept **third-party/untrusted plugins** and need real sandboxing.
- A plugin needs **independent deploy/version cadence** from the worker.

At that point: introduce an `OutOfProcessAdapter` that implements the same stage interface and
proxies to a subprocess/container over stdio or HTTP. Because the interface is stable, this is
additive — existing in-process plugins and the core are untouched.

## Implementation notes

- Adapters live in `plugins/<stage>/<id>/` and self-register into the worker's `Registry` at startup.
- Every adapter wraps engine invocation with: timeout, `SIGKILL` on timeout, stderr capture,
  and translation of non-zero exit / non-2xx into a typed `StageError{stage, reason}`.
- Long outputs (STL, gcode) are written to the shared `/data` volume; adapters pass
  `Artifact{path}` handles, never buffers — so even today nothing large crosses a boundary.
