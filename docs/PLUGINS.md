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
  // Zod-derived JSON Schema → the PWA renders the config form from this.
  paramSchema: JSONSchema7;
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

Default: **`gridfinity`** wraps `gridfinity-rebuilt-openscad`:
`openscad -o out.stl -D 'gridx=2;gridy=3;...' gridfinity.scad`.

## Stage 2 — Slicer

```ts
export interface SlicerPlugin extends PluginManifest {
  stage: "slicer";
  accepts: string[];                       // input formats, e.g. ["stl", "3mf"]
  gcodeFlavor: string;                     // emitted flavor, e.g. "marlin", "klipper"
  profiles: ProfileRef[];                  // curated, locked, server-side only
  slice(model: ModelArtifact, profileId: string, ctx: StageCtx): Promise<GcodeArtifact>;
}

export interface ProfileRef {
  id: string;                              // "orca/elegoo-pla-0.2"
  name: string;                            // shown in the admin UI, not to end users
  path: string;                            // path to the locked profile bundle
}
```

Default: **`orca`** runs the OrcaSlicer CLI under `xvfb` in the worker image.
A 2nd adapter (PrusaSlicer CLI) is the contract's proof-of-pluggability.

## Stage 3 — Transport

```ts
export interface TransportPlugin extends PluginManifest {
  stage: "transport";
  acceptsFlavors: string[];                // gcode flavors it can print
  discover?(): Promise<PrinterTarget[]>;   // optional mDNS/network discovery
  submit(gcode: GcodeArtifact, target: PrinterTarget, ctx: StageCtx): Promise<PrintHandle>;
  status(handle: PrintHandle): AsyncIterable<PrintStatus>;
  cancel?(handle: PrintHandle): Promise<void>;
}

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

## Station — what end users actually pick

```ts
// Admin binds a printer to a slicer profile once; users only ever choose a Station.
export interface Station {
  id: string;
  name: string;                            // "Garage Klipper — PLA 0.2mm"
  transportId: string;
  printerId: string;                       // a PrinterTarget.id
  slicerId: string;
  profileId: string;                       // a ProfileRef.id
  allowedGenerators?: string[];            // optional allowlist per station
}
```

## Job & lifecycle

```ts
export interface JobRequest {
  generator: { id: string; params: unknown };
  stationId: string;                       // resolves slicer + profile + printer
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

// Validated before enqueue:
//   generator.outputs ∩ slicer.accepts ≠ ∅
//   slicer.gcodeFlavor ∈ transport.acceptsFlavors
export function validateJob(req: JobRequest, reg: Registry): void;
```

## Adding a plugin (the whole checklist)

1. Create `plugins/<stage>/<id>/` exporting an object that satisfies the stage interface.
2. Declare `capabilities` (formats / flavors) and (generators) a Zod param schema.
3. Register it in the worker's startup registry.
4. For slicers/transports wrapping a CLI/API: keep all I/O inside the adapter; the core never learns the tool's name.
