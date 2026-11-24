import type { Tree } from "../comments/tree";
import { parseBaseline, serializeBaseline } from "../lines/baseline";
import type { Counts } from "../lines/count";
import { measure } from "./count";

export const BASELINE_PATH = "scripts/checks/casts/baseline.json";

export const CHECKER_PATH = "scripts/checks/casts.ts";

export interface RatchetInput {
  current: Counts;
  committed: string | null;
  base: Tree;
}

export function allowanceFrom(base: Tree): Counts | string {
  const text = base.read(BASELINE_PATH);
  if (text !== null) return parseBaseline(text) ?? `base ${BASELINE_PATH} is not a valid baseline`;
  if (base.read(CHECKER_PATH) !== null) return `base has the checker but no ${BASELINE_PATH}`;
  return measure(base);
}

function overAllowance(counts: Counts, allowance: Counts, label: string): string[] {
  return Object.entries(counts).flatMap(([path, casts]) => {
    const allowed = allowance[path] ?? 0;
    if (casts <= allowed) return [];
    return [
      `${label}: ${path}: ${casts} \`as\` casts (base allows ${allowed}); parse the value instead`,
    ];
  });
}

export function checkRatchet(input: RatchetInput): string[] {
  if (input.committed === null) return [`${BASELINE_PATH} is missing`];
  const committed = parseBaseline(input.committed);
  if (committed === null) return [`${BASELINE_PATH} is not a valid baseline`];
  const allowance = allowanceFrom(input.base);
  if (typeof allowance === "string") return [allowance];
  const errors = [
    ...overAllowance(input.current, allowance, "new cast"),
    ...overAllowance(committed, allowance, "baseline raised"),
  ];
  if (errors.length === 0 && serializeBaseline(input.current) !== input.committed) {
    errors.push(`${BASELINE_PATH} is stale; run \`bun run check:casts:update\` and commit it`);
  }
  return errors;
}
