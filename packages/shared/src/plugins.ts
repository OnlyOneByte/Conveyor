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

// ─── Stage 1: Generator ──────────────────────────────────────────────────────

export interface GeneratorPlugin<P = unknown> extends PluginManifest {
  stage: "generator";
  /** Zod-derived JSON Schema → the PWA renders the config form from this. */
  paramSchema: JSONSchema7;
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
  /** shown in the admin UI, never to end users */
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
