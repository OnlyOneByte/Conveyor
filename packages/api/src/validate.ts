import { type JobRequest, type JobTarget, type ParamIssue, validateJob } from "@conveyor/shared";
import type { ZodIssue } from "zod";
import { apiRegistry } from "./registry-view.js";

export function validateJobRequest(req: JobRequest, target: JobTarget): void {
  validateJob(req, target, apiRegistry);
}

export type ParamsResult = { ok: true; params: unknown } | { ok: false; error: string };

type FieldPath = readonly (string | number)[];

const fieldName = (path: FieldPath) => (path.length > 0 ? path.join(".") : "body");

function describeIssue(issue: ZodIssue, prefix: FieldPath): string[] {
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => `${fieldName([...prefix, ...issue.path, key])}: unknown field`);
  }
  return [`${fieldName([...prefix, ...issue.path])}: ${issue.message}`];
}

export function describeIssues(issues: readonly ZodIssue[], prefix: FieldPath = []): string {
  return issues.flatMap((issue) => describeIssue(issue, prefix)).join("; ");
}

const PARAMS: FieldPath = ["generator", "params"];

const describeHookIssue = (issue: ParamIssue) =>
  `${fieldName([...PARAMS, issue.field])}: ${issue.message}`;

export function parseGeneratorParams(req: JobRequest): ParamsResult {
  const generator = apiRegistry.generators.get(req.generator.id);
  if (!generator) return { ok: false, error: `unknown generator: ${req.generator.id}` };
  const parsed = generator.params.safeParse(req.generator.params);
  if (!parsed.success) {
    return { ok: false, error: describeIssues(parsed.error.issues, PARAMS) };
  }
  const issue = generator.validateRequest?.(parsed.data) ?? null;
  if (issue) return { ok: false, error: describeHookIssue(issue) };
  return { ok: true, params: parsed.data };
}

export function listTransports(): { id: string; name: string; acceptsFlavors: string[] }[] {
  return [...apiRegistry.transports.values()].map((t) => ({
    id: t.id,
    name: t.name,
    acceptsFlavors: [...t.acceptsFlavors],
  }));
}
