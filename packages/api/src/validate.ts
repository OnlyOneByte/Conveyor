import {
  CompatibilityError,
  type JobRequest,
  type JobTarget,
  type ParamIssue,
  validateJob,
} from "@conveyor/shared";
import type { ZodIssue } from "zod";
import { apiRegistry } from "./registry-view.js";

export function validateJobRequest(req: JobRequest, target: JobTarget): void {
  validateJob(req, target, apiRegistry);
}

export type ParamsResult = { ok: true; params: unknown } | { ok: false; error: string };

const paramField = (path: readonly (string | number)[]) => ["generator.params", ...path].join(".");

function describeIssue(issue: ZodIssue): string[] {
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => `${paramField([...issue.path, key])}: unknown field`);
  }
  return [`${paramField(issue.path)}: ${issue.message}`];
}

const describeHookIssue = (issue: ParamIssue) => `${paramField([issue.field])}: ${issue.message}`;

export function parseGeneratorParams(req: JobRequest): ParamsResult {
  const generator = apiRegistry.generators.get(req.generator.id);
  if (!generator) return { ok: false, error: `unknown generator: ${req.generator.id}` };
  const parsed = generator.params.safeParse(req.generator.params);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.flatMap(describeIssue).join("; ") };
  }
  const issue = generator.validateRequest?.(parsed.data) ?? null;
  if (issue) return { ok: false, error: describeHookIssue(issue) };
  return { ok: true, params: parsed.data };
}

export function validatePrinterTransport(transportId: string): void {
  if (!apiRegistry.transports.get(transportId)) {
    throw new CompatibilityError(`unknown transport: ${transportId}`);
  }
}

export function listTransports(): { id: string; name: string; acceptsFlavors: string[] }[] {
  return [...apiRegistry.transports.values()].map((t) => ({
    id: t.id,
    name: t.name,
    acceptsFlavors: [...t.acceptsFlavors],
  }));
}
