import type { JSONSchema7 } from "json-schema";
import type { ZodType } from "zod";
import type { GcodeArtifact, ModelArtifact } from "./artifacts.js";
import type { StageCtx } from "./context.js";

export type { JSONSchema7 } from "json-schema";

export type Stage = "generator" | "slicer" | "transport";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  stage: Stage;
}

export interface PreviewDescriptor {
  kind: "procedural";
  module: string;
}

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

export interface ParamIssue {
  field: string;
  message: string;
}

export interface GeneratorPlugin<P = unknown> extends PluginManifest {
  stage: "generator";
  params: ZodType<P, unknown>;
  paramSchema: JSONSchema7;
  validateRequest?(params: P): ParamIssue | null;
  ui?: FormUiHints;
  preview?: PreviewDescriptor;
  outputs: string[];
  generate(params: P, ctx: StageCtx): Promise<ModelArtifact>;
}

export interface ProfileRef {
  id: string;
  name: string;
  path: string;
}

export interface SlicerPlugin extends PluginManifest {
  stage: "slicer";
  accepts: string[];
  gcodeFlavor: string;
  slice(model: ModelArtifact, profile: ProfileRef, ctx: StageCtx): Promise<GcodeArtifact>;
}

export interface PrinterTarget {
  id: string;
  transportId: string;
  address: string;
  secrets?: Record<string, string>;
}

export interface PrintHandle {
  transportId: string;
  printerId: string;
  ref: string;
  address?: string;
  deviceId?: string;
}

export interface PrintStatus {
  state: "transferring" | "printing" | "done" | "failed" | "canceled";
  progress?: number;
  message?: string;
}

export interface TransportPlugin extends PluginManifest {
  stage: "transport";
  acceptsFlavors: string[];
  submit(gcode: GcodeArtifact, target: PrinterTarget, ctx: StageCtx): Promise<PrintHandle>;
  status(handle: PrintHandle, signal?: AbortSignal): AsyncIterable<PrintStatus>;
  cancel?(handle: PrintHandle): Promise<void>;
  handleFor?(target: PrinterTarget, ref: string): PrintHandle;
}
