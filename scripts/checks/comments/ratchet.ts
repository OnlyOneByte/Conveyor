import { type AreaTexts, BASELINE_DIR, LEGACY_BASELINE_PATH, parseAreas, readAreas } from "./areas";
import { type Baseline, type Excess, excesses, parseBaseline, sameBaseline } from "./baseline";
import { measure, type Tree } from "./tree";

const CHECKER_PATH = "scripts/checks/comments.ts";

export interface RatchetInput {
  current: Baseline;
  present: ReadonlySet<string>;
  committed: AreaTexts;
  base: Tree;
}

export interface RatchetResult {
  errors: string[];
}

const describe = (excess: Excess, against: string) =>
  `${excess.file}: ${excess.actual} ${excess.metric} (${against} ${excess.allowed})`;

export function allowanceFrom(base: Tree): Baseline | string {
  const areas = parseAreas(readAreas(base));
  if (typeof areas === "string") return `base ${areas}`;
  if (areas !== null) return areas;
  const text = base.read(LEGACY_BASELINE_PATH);
  if (text !== null) {
    return parseBaseline(text) ?? `base ${LEGACY_BASELINE_PATH} is not a valid baseline`;
  }
  if (base.read(CHECKER_PATH) !== null) return `base has the checker but no ${BASELINE_DIR}/`;
  return measure(base);
}

export function checkRatchet(input: RatchetInput): RatchetResult {
  const committed = parseAreas(input.committed);
  if (committed === null) return { errors: [`${BASELINE_DIR}/ is missing`] };
  if (typeof committed === "string") return { errors: [committed] };
  const allowance = allowanceFrom(input.base);
  if (typeof allowance === "string") return { errors: [allowance] };
  const { present } = input;
  const added = excesses({ actual: input.current, allowed: allowance, present });
  const raised = excesses({ actual: committed, allowed: allowance, present });
  const errors = [
    ...added.map((e) => `added: ${describe(e, "base allows")}`),
    ...raised.map((e) => `baseline raised: ${describe(e, "base has")}`),
  ];
  if (errors.length === 0 && !sameBaseline(input.current, committed)) {
    errors.push(`${BASELINE_DIR}/ is stale; run \`bun run check:comments:update\` and commit it`);
  }
  return { errors };
}
