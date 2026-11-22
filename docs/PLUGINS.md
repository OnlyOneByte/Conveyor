# Conveyor — Plugin Contracts

All contracts live in the `shared` package and are imported by `api` and `worker`.
Plugins self-register into a per-stage `Registry` at startup. A `Job` is validated for
cross-stage capability compatibility before being enqueued.

## Shared artifacts

```ts
// An on-disk artifact in the shared /data volume, passed between stages.
export interface Artifact {
  path: string;                          // absolute path under /data
  format: string;                        // "stl" | "3mf" | "obj" | "gcode" | ...
  meta?: Record<string, unknown>;
}
export type ModelArtifact = Artifact;    // generator output / slicer input
export type GcodeArtifact = Artifact;    // slicer output / transport input
```

## Common manifest

```ts
export interface PluginManifest {
  id: string;            // stable, unique within a stage: "gridfinity", "orca"
  name: string;          // human label for the UI
  version: string;
  stage: "generator" | "slicer" | "transport";
}
```

## Stage 1 — Generator

```ts
import type { JSONSchema7 } from "json-schema";

export interface GeneratorPlugin<P = unknown> extends PluginManifest {
  stage: "generator";
  // Strict zod schema; POST /jobs parses params with it (defaults applied) and answers 400 naming the field.
  params: ZodType<P, ZodTypeDef, unknown>;
  // Zod-derived JSON Schema → the PWA renders the config form from this.
  paramSchema: JSONSchema7;
  // Optional request-time check on parsed params, e.g. that an upload exists; null means OK.
  validateRequest?(params: P): ParamIssue | null;
  // Optional layout hints for that form: groups, an advanced section, controls, units.
  ui?: FormUiHints;
  // Optional procedural-preview descriptor for the client-side fast viewport.
  preview?: PreviewDescriptor;
  // Declares the model format(s) this generator can emit.
  outputs: string[];                       // e.g. ["stl", "3mf"]
  // Server-side, exact model generation (shells out to OpenSCAD etc.).
  generate(params: P, ctx: StageCtx): Promise<ModelArtifact>;
}

// Hint for client-side Three.js/Threlte preview — keeps render off the server.
export interface PreviewDescriptor {
  kind: "procedural";
  module: string;            // client module id that builds geometry from params
}
```

`FormUiHints` (groups, `advanced`, `controls`, `unitMm`, `note`) is in `packages/shared/src/plugins.ts`; what each
field does is in [modules/shared.md](modules/shared.md#form-presentation-hints).

Bundled: **`gridfinity`** wraps `gridfinity-rebuilt-openscad`, running
`openscad -o model.stl -D gridx=2 -D gridy=3 ... gridfinity-rebuilt-bins.scad` (override the file with
`GRIDFINITY_SCAD`), and **`passthrough`** hands an uploaded STL to the slicer unchanged.

## Stage 2 — Slicer

```ts
export interface SlicerPlugin extends PluginManifest {
  stage: "slicer";
  accepts: string[];                       // input formats, e.g. ["stl", "3mf"]
  gcodeFlavor: string;                     // emitted flavor, e.g. "marlin", "klipper"
  profiles: ProfileRef[];                  // curated, locked, server-side only
  slice(model: ModelArtifact, profile: ProfileRef, ctx: StageCtx): Promise<GcodeArtifact>;
}

export interface ProfileRef {
  id: string;                              // "orca/klipper-pla-0.2"
  name: string;                            // shown in Settings, not to end users
  path: string;                            // path to the locked profile bundle
}
```

Bundled: **`orca`** runs the OrcaSlicer CLI under `xvfb-run`, and **`prusa`** runs the PrusaSlicer CLI. Neither
is a default: a job's profile names its slicer, and the seed ships profiles for both.

## Stage 3 — Transport

```ts
export interface TransportPlugin extends PluginManifest {
  stage: "transport";
  acceptsFlavors: string[];                // gcode flavors it can print
  discover?(): Promise<PrinterTarget[]>;   // optional mDNS/network discovery
  submit(gcode: GcodeArtifact, target: PrinterTarget, ctx: StageCtx): Promise<PrintHandle>;
  status(handle: PrintHandle, signal?: AbortSignal): AsyncIterable<PrintStatus>; // stop when signal aborts
  cancel?(handle: PrintHandle): Promise<void>;     // resolve only once the printer confirmed the stop
  handleFor?(target: PrinterTarget, ref: string): PrintHandle; // handle for a submit() that never returned
}
```

`submit()` must check `ctx.signal` between the upload and the start command, and throw `PrintNotStartedError` (from `@conveyor/shared`) when it is cancelled before the start command was sent. The worker sends no stop for that error. Any other error from `submit()` after a cancel is treated as "the print may have started", and the worker sends a stop.

```ts
export interface PrinterTarget {
  id: string;                              // "klipper-garage"
  transportId: string;                     // which transport owns it
  address: string;                         // host:port / serial / mqtt topic
  secrets?: Record<string, string>;        // api keys, never sent to the client
}

export interface PrintStatus {
  state: "transferring" | "printing" | "done" | "failed" | "canceled";
  progress?: number;                       // 0..1
  message?: string;
}
```

First adapters: **`moonraker`** (Klipper HTTP API) and **`elegoo`** (ElegooLink / SDCP).

## Print target — what end users actually pick

```ts
// A job names a printer and a profile. The transport comes from the printer and the
// slicer and flavour from the profile, so the pair is the whole print configuration —
// there is no separate saved binding to curate. The api resolves the pair into this.
export interface JobTarget {
  printerId: string;                       // a PrinterTarget.id
  transportId: string;                     // from the printer
  profileId: string;                       // a ProfileRef.id
  profileName: string;
  profilePath: string;                     // bundle dir under /profiles
  slicerId: string;                        // from the profile
  gcodeFlavor: string;                     // from the profile
  allowedGenerators?: string[];            // the printer's allowlist; absent = unrestricted
}
```

## Job & lifecycle

```ts
export interface JobRequest {
  generator: { id: string; params: unknown };
  printerId: string;                       // → transport
  profileId: string;                       // → slicer + gcode flavour
}

export type JobState =
  | "queued" | "generating" | "slicing"
  | "transferring" | "printing"
  | "done" | "failed" | "canceled";
```

## Registry & compatibility

```ts
export interface Registry {
  generators: Map<string, GeneratorPlugin>;
  slicers: Map<string, SlicerPlugin>;
  transports: Map<string, TransportPlugin>;
}

// Validated before enqueue, in this order; the first failure throws CompatibilityError:
//   the generator exists
//   generator.id ∈ target.allowedGenerators (when the printer has an allowlist)
//   the slicer and the transport exist
//   generator.outputs ∩ slicer.accepts ≠ ∅
//   target.gcodeFlavor (the profile's) ∈ transport.acceptsFlavors
export function validateJob(req: JobRequest, target: JobTarget, reg: Registry): void;
```

## Adding a plugin (the whole checklist)

1. Create `plugins/<stage>/<id>/` (a Bun workspace package) exporting an object that satisfies the stage interface.
2. Declare what it handles: `outputs`, a strict zod `params` schema and the `paramSchema` derived from it for a generator, `accepts`, `gcodeFlavor` and `profiles` for a slicer, `acceptsFlavors` for a transport.
3. Register it in the worker's `buildRegistry` (`packages/worker/src/registry.ts`).
4. Make the api know it too (`packages/api/src/registry-view.ts`): a generator is imported and registered as-is, while a slicer or transport is declared inline as metadata, because the api never runs one.
5. For slicers/transports wrapping a CLI/API: keep all I/O inside the adapter; the core never learns the tool's name.
