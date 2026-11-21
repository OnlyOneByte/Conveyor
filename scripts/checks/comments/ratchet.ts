import { type Baseline, type Excess, excesses, parseBaseline, sameBaseline } from "./baseline";
import { measure, type Tree } from "./tree";

export const BASELINE_PATH = "scripts/checks/comments-baseline.json";

const CHECKER_PATH = "scripts/checks/comments.ts";

export interface RatchetInput {
  current: Baseline;
  committed: string | null;
  base: Tree;
}

export interface RatchetResult {
  errors: string[];
}

const describe = (excess: Excess, against: string) =>
  `${excess.file}: ${excess.actual} ${excess.metric} (${against} ${excess.allowed})`;

export function allowanceFrom(base: Tree): Baseline | string {
  const text = base.read(BASELINE_PATH);
  if (text !== null) return parseBaseline(text) ?? `base ${BASELINE_PATH} is not a valid baseline`;
  if (base.read(CHECKER_PATH) !== null) return `base has the checker but no ${BASELINE_PATH}`;
  return measure(base);
}

export function checkRatchet(input: RatchetInput): RatchetResult {
  if (input.committed === null) return { errors: [`${BASELINE_PATH} is missing`] };
  const committed = parseBaseline(input.committed);
  if (committed === null) return { errors: [`${BASELINE_PATH} is not a valid baseline`] };
  const allowance = allowanceFrom(input.base);
  if (typeof allowance === "string") return { errors: [allowance] };
  const errors = [
    ...excesses(input.current, allowance).map((e) => `added: ${describe(e, "base allows")}`),
    ...excesses(committed, allowance).map((e) => `baseline raised: ${describe(e, "base has")}`),
  ];
  if (errors.length === 0 && !sameBaseline(input.current, committed)) {
    errors.push(`${BASELINE_PATH} is stale; run \`bun run check:comments:update\` and commit it`);
  }
  return { errors };
}
