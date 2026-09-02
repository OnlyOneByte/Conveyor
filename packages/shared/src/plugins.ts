import type { JSONSchema7 } from "json-schema";
import type { GcodeArtifact, ModelArtifact } from "./artifacts.js";
import type { StageCtx } from "./context.js";

// Re-exported so plugins depend only on @conveyor/shared, not json-schema directly.
export type { JSONSchema7 } from "json-schema";

export type Stage = "generator" | "slicer" | "transport";

export interface PluginManifest {
  /** stable, unique within a stage: "gridfinity", "orca", "moonraker" */
  id: string;
  /** human label for the UI */
  name: string;
  version: string;
  stage: Stage;
}

/** Hint for the client-side fast viewport — keeps preview rendering off the server. */
export interface PreviewDescriptor {
  kind: "procedural";
  /** client module id that builds Three.js/Threlte geometry from params */
  module: string;
}

// ─── Form presentation hints ─────────────────────────────────────────────────
// The PWA renders the config form straight from paramSchema (ADR: dynamic forms,
// zero per-generator UI code). These OPTIONAL hints let a generator say how its
// fields should be grouped and which are advanced, WITHOUT the form component
// learning any generator-specific field names. A generator that omits them renders
// as a flat list of controls exactly as before.

/** Preferred control for a field. Omitted → inferred from the JSON Schema type. */
export type FormControl = "stepper" | "slider" | "checkbox";

export interface FormGroup {
  /** Heading above the group. Omit for an unlabelled cluster. */
  title?: string;
  /** Field keys, in render order. */
  fields: string[];
  /**
   * pair  → two controls on one row separated by "×"
   * stack → one control per row (default)
   * grid  → two-column grid, for compact booleans
   */
  layout?: "pair" | "stack" | "grid";
}

export interface FormUiHints {
  /** Primary groups — always visible. */
  groups?: FormGroup[];
  /** Everything else, behind a disclosure. */
  advanced?: { title: string; groups: FormGroup[] };
  /** Per-field control override. */
  controls?: Record<string, FormControl>;
  /**
   * Millimetres that one unit of a field represents. Drives the live size readout
   * beside a group heading, e.g. gridfinity's 42mm footprint / 7mm height units.
   */
  unitMm?: Record<string, number>;
  /** Small static legend rendered under the primary groups. */
  note?: string;
}

// ─── Stage 1: Generator ──────────────────────────────────────────────────────

export interface GeneratorPlugin<P = unknown> extends PluginManifest {
  stage: "generator";
  /** Zod-derived JSON Schema → the PWA renders the config form from this. */
  paramSchema: JSONSchema7;
  /** optional grouping/advanced/control hints for that generated form */
  ui?: FormUiHints;
  /** optional procedural-preview descriptor for the client-side fast viewport */
  preview?: PreviewDescriptor;
  /** model format(s) this generator can emit, e.g. ["stl", "3mf"] */
  outputs: string[];
  /** server-side, exact model generation (shells out to OpenSCAD etc.) */
  generate(params: P, ctx: StageCtx): Promise<ModelArtifact>;
}

// ─── Stage 2: Slicer ─────────────────────────────────────────────────────────

export interface ProfileRef {
  /** "orca/elegoo-pla-0.2" */
  id: string;
  /** shown in Settings, never to end users */
  name: string;
  /** path to the locked profile bundle */
  path: string;
}

export interface SlicerPlugin extends PluginManifest {
  stage: "slicer";
  /** input formats, e.g. ["stl", "3mf"] */
  accepts: string[];
  /** emitted flavor, e.g. "marlin" | "klipper" */
  gcodeFlavor: string;
  /** curated, locked, server-side only */
  profiles: ProfileRef[];
  slice(model: ModelArtifact, profileId: string, ctx: StageCtx): Promise<GcodeArtifact>;
}

// ─── Stage 3: Transport ──────────────────────────────────────────────────────

export interface PrinterTarget {
  /** "klipper-garage" */
  id: string;
  /** which transport owns it */
  transportId: string;
  /** host:port / serial / mqtt topic */
  address: string;
  /** api keys etc. — resolved server-side, never sent to the client */
  secrets?: Record<string, string>;
}

export interface PrintHandle {
  transportId: string;
  printerId: string;
  /** transport-specific job reference (filename, task id, …) */
  ref: string;
  /** device address (host:port / ip) so status()/cancel() can reach it without
   *  re-resolving the printer. Server-side only — never leaves the worker. */
  address?: string;
}

export interface PrintStatus {
  state: "transferring" | "printing" | "done" | "failed" | "canceled";
  /** 0..1 */
  progress?: number;
  message?: string;
}

export interface TransportPlugin extends PluginManifest {
  stage: "transport";
  /** gcode flavors it can print */
  acceptsFlavors: string[];
  /** optional mDNS/network discovery */
  discover?(): Promise<PrinterTarget[]>;
  submit(gcode: GcodeArtifact, target: PrinterTarget, ctx: StageCtx): Promise<PrintHandle>;
  status(handle: PrintHandle): AsyncIterable<PrintStatus>;
  cancel?(handle: PrintHandle): Promise<void>;
}
