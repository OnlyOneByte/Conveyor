import type { Tree } from "../comments/tree";
import { BASELINE_PATH, parseBaseline, serializeBaseline } from "./baseline";
import { type Counts, limitOf, measure, overLimit } from "./count";

export const CHECKER_PATH = "scripts/checks/lines.ts";

export interface RatchetInput {
  current: Counts;
  committed: string | null;
  base: Tree;
}

export interface RatchetResult {
  errors: string[];
}

export function allowanceFrom(base: Tree): Counts | string {
  const text = base.read(BASELINE_PATH);
  if (text !== null) return parseBaseline(text) ?? `base ${BASELINE_PATH} is not a valid baseline`;
  if (base.read(CHECKER_PATH) !== null) return `base has the checker but no ${BASELINE_PATH}`;
  return overLimit(measure(base));
}

function overCeiling(counts: Counts, allowance: Counts, label: string): string[] {
  return Object.entries(counts).flatMap(([path, lines]) => {
    const allowed = allowance[path] ?? 0;
    const limit = limitOf(path);
    if (lines <= Math.max(limit, allowed)) return [];
    const against = allowed > limit ? `base allows ${allowed}` : `limit ${limit}`;
    return [`${label}: ${path}: ${lines} lines (${against})`];
  });
}

export function checkRatchet(input: RatchetInput): RatchetResult {
  if (input.committed === null) return { errors: [`${BASELINE_PATH} is missing`] };
  const committed = parseBaseline(input.committed);
  if (committed === null) return { errors: [`${BASELINE_PATH} is not a valid baseline`] };
  const allowance = allowanceFrom(input.base);
  if (typeof allowance === "string") return { errors: [allowance] };
  const errors = [
    ...overCeiling(input.current, allowance, "too long"),
    ...overCeiling(committed, allowance, "baseline raised"),
  ];
  if (errors.length === 0 && serializeBaseline(overLimit(input.current)) !== input.committed) {
    errors.push(`${BASELINE_PATH} is stale; run \`bun run check:lines:update\` and commit it`);
  }
  return { errors };
}
