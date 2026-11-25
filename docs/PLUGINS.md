# Conveyor — Plugin Contracts

This page is the plugin contract: every interface a plugin implements or receives, and what each field
means. The types are in `packages/shared/src/plugins.ts` (with `artifacts.ts`, `context.ts`, `job.ts` and
`registry.ts`), exported from `@conveyor/shared`, and imported by `api`, `worker` and the plugins.
JSON Schema's `JSONSchema7` type is re-exported there too, so a plugin depends only on `@conveyor/shared`.

Nothing self-registers: the api and the worker each build the same per-stage `Registry` at startup by
calling `buildRegistry` from `@conveyor/plugin-registry`, the one list of bundled plugins. A `Job` is validated for
cross-stage capability compatibility before being enqueued. How the bundled plugins work inside is in
[modules/plugins.md](modules/plugins.md).

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

Every stage also gets a `StageCtx` (`workDir`, `report`, `reportUpload`, `signal`) and fails by throwing a
`StageError`; both are described in [modules/shared.md](modules/shared.md#contextts).

## Common manifest

```ts
export type Stage = "generator" | "slicer" | "transport";

export interface PluginManifest {
  id: string;            // stable, unique within a stage: "gridfinity", "orca", "moonraker"
  name: string;          // human label for the UI
  version: string;
  stage: Stage;
}
```

## Stage 1 — Generator

```ts
export interface GeneratorPlugin<P = unknown> extends PluginManifest {
  stage: "generator";
  params: ZodType<P, unknown>;             // strict zod schema for the params
  paramSchema: JSONSchema7;                // JSON Schema derived from params; the PWA renders the form from it
  validateRequest?(params: P): ParamIssue | null; // request-time check on parsed params; null means OK
  ui?: FormUiHints;                        // layout hints for that form
  preview?: PreviewDescriptor;             // procedural-preview descriptor for the client viewport
  outputs: string[];                       // model formats it can emit, e.g. ["stl", "3mf"]
  generate(params: P, ctx: StageCtx): Promise<ModelArtifact>;
}

export interface ParamIssue {
  field: string;
  message: string;
}

export interface PreviewDescriptor {
  kind: "procedural";
  module: string;                          // client module id that builds geometry from params
}
```

- `params` is the generator's strict zod schema: `POST /jobs` parses the request's params with it, applies
  its defaults, rejects unknown keys and answers 400 naming the field.
- `validateRequest`, when present, checks the parsed params against the outside world. Passthrough checks
  that the upload is a regular `.stl` file in the uploads directory, within `MAX_UPLOAD_BYTES`, with an STL
  header.
- `generate` is the exact, server-side model generation, which shells out to OpenSCAD and similar.
- `PreviewDescriptor` points the client-side viewport at a module that builds Three.js geometry from the
  params, which keeps preview rendering off the server (ADR 0002).

### Form presentation hints

```ts
export type FormControl = "stepper" | "slider" | "checkbox";

export interface FormGroup {
  title?: string;
  fields: string[];
  layout?: "pair" | "stack" | "grid";
}

export interface FormUiHints {
  groups?: FormGroup[];
  advanced?: { title: string; groups: FormGroup[] };
  controls?: Record<string, FormControl>;
  unitMm?: Record<string, number>;
  note?: string;
}
```

The PWA renders a generator's config form straight from `paramSchema`, with no per-generator UI code.
`FormUiHints` lets a generator say how its fields are grouped and which are advanced, without the form
component learning any generator-specific field names. A generator that omits them renders as a flat list
of controls.

- `FormControl` is the preferred control for a field; when omitted it is inferred from the JSON Schema type.
- `FormGroup.title` is the heading above the group; omit it for an unlabelled cluster. `fields` are field
  keys in render order.
- `FormGroup.layout`: `pair` puts two controls on one row separated by `×`; `stack` (the default) puts one
  control per row; `grid` is a two-column grid for compact booleans.
- `groups` are always visible; `advanced` sits behind a disclosure; `controls` overrides the control per
  field.
- `unitMm` is the millimetres one unit of a field represents. It drives the live size readout beside a
  group heading, for example gridfinity's 42 mm footprint and 7 mm height units.
- `note` is a small static legend under the primary groups.

Bundled: **`gridfinity`** wraps `gridfinity-rebuilt-openscad`, running
`openscad -o model.stl -D gridx=2 -D gridy=3 ... gridfinity-rebuilt-bins.scad` (override the file with
`GRIDFINITY_SCAD`), and **`passthrough`** hands an uploaded STL to the slicer unchanged.

## Stage 2 — Slicer

```ts
export interface SlicerPlugin extends PluginManifest {
  stage: "slicer";
  accepts: string[];                       // input formats, e.g. ["stl", "3mf"]
  gcodeFlavor: string;                     // declared only; checks use the profile's gcodeFlavor
  slice(model: ModelArtifact, profile: ProfileRef, ctx: StageCtx): Promise<GcodeArtifact>;
}

export interface ProfileRef {
  id: string;                              // "orca/klipper-pla-0.2"
  name: string;                            // shown in Settings, not to end users
  path: string;                            // the profile bundle directory
}
```

- A slicer declares no profile list: profiles are rows in SQLite, seeded once from `DEFAULT_PROFILES`.
- `slice` receives a profile the worker has already resolved. `path` is a bundled directory or a per-job
  directory the worker materialized from edited JSON. Adapters consume the path; they don't own profile
  persistence or look ids up in a hard-coded list, so edited profiles reach Orca without coupling the
  plugin to SQLite.
- `gcodeFlavor` is the flavour the slicer declares (`marlin`, `klipper`). Compatibility checks use the
  profile's flavour instead, because one slicer can ship profiles that emit others.

Bundled: **`orca`** runs the OrcaSlicer CLI under `xvfb-run`, and **`prusa`** runs the PrusaSlicer CLI. Neither
is a default: a job's profile names its slicer, and the seed ships profiles for both.

## Stage 3 — Transport

```ts
export interface TransportPlugin extends PluginManifest {
  stage: "transport";
  acceptsFlavors: string[];                // gcode flavors it can print
  submit(gcode: GcodeArtifact, target: PrinterTarget, ctx: StageCtx): Promise<PrintHandle>;
  status(handle: PrintHandle, signal?: AbortSignal, target?: PrinterTarget): AsyncIterable<PrintStatus>; // stop when signal aborts
  cancel?(handle: PrintHandle, target?: PrinterTarget): Promise<void>; // resolve only once the printer confirmed the stop
  handleFor?(target: PrinterTarget, ref: string): PrintHandle; // handle for a submit() that never returned
}
```

The worker passes the job's printer, secrets included, as `target` to `status()` and `cancel()`, so a transport can authenticate every request the way `submit()` did. The handle is stored with the job, so keep secrets off it.

`submit()` must check `ctx.signal` between the upload and the start command, and throw `PrintNotStartedError` (from `@conveyor/shared`) when it is cancelled before the start command was sent. The worker sends no stop for that error. Any other error from `submit()` after a cancel is treated as "the print may have started", and the worker sends a stop.

```ts
export interface PrinterTarget {
  id: string;                              // "klipper-garage"
  transportId: string;                     // which transport owns it
  address: string;                         // host:port, serial device or MQTT topic
  secrets?: Record<string, string>;        // API keys and the like
}

export interface PrintHandle {
  transportId: string;
  printerId: string;
  ref: string;                             // transport-specific job reference: a filename, a task id
  address?: string;                        // the device address, so status() and cancel() need no lookup
  deviceId?: string;                       // a device id the transport addressed, e.g. Elegoo's mainboard
}

export interface PrintStatus {
  state: "transferring" | "printing" | "done" | "failed" | "canceled";
  progress?: number;                       // 0..1
  message?: string;
  print?: PrintProgress;
}

export interface PrintProgress {           // from events.ts
  layer?: number;
  layers?: number;
  secondsLeft?: number;
}
```

- `secrets` are resolved server-side and never sent to the client. The same goes for `PrintHandle.address`,
  which never leaves the worker.
- There is no discovery hook: printers are added with an explicit address.

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
// Inferred from jobRequestSchema (zod), which POST /jobs and the worker both parse with.
export type JobRequest = {
  generator: { id: string; params?: unknown };
  printerId: string;                       // → transport
  profileId: string;                       // → slicer + gcode flavour
};

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

Why the checks run in that order is in [modules/shared.md](modules/shared.md#registryts).

## Adding a plugin (the whole checklist)

1. Create `plugins/<stage>/<id>/` (a Bun workspace package) exporting an object that satisfies the stage interface.
2. Declare what it handles: `outputs`, a strict zod `params` schema and the `paramSchema` derived from it for a generator, `accepts` and `gcodeFlavor` for a slicer, `acceptsFlavors` for a transport.
3. Register it in `buildRegistry` (`plugins/registry/builtin/src/index.ts`, package `@conveyor/plugin-registry`) and add it to that package's `dependencies` as `"workspace:*"`, then run `bun install`. The api and the worker both build their registry there, so they can't disagree about which plugins exist or what they accept.
4. Add a `COPY <plugin>/package.json` line to all three `packages/*/Dockerfile`s: `bun install --frozen-lockfile` needs every workspace member's manifest, even in images that never import it.
5. For a slicer, give it at least one profile: a bundle directory under `profiles/` and a profile row naming its `slicerId`, `path` and `gcodeFlavor`, either in `packages/shared/src/db/seed.ts` or added in Settings. Jobs pick a profile, never a slicer, so a slicer with no profile row is never used.
6. For slicers/transports wrapping a CLI/API: keep all I/O inside the adapter; the core never learns the tool's name.
