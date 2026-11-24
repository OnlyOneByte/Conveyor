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
  present: ReadonlySet<string>;
  pairs: readonly Pair[];
}

export interface Pair {
  from: string;
  to: string;
}

export function parsePairs(nameStatus: string): Pair[] {
  const fields = nameStatus.split("\0");
  const pairs: Pair[] = [];
  for (let i = 0; i < fields.length; ) {
    const status = fields[i] ?? "";
    if (/^[RC]\d*$/.test(status)) {
      pairs.push({ from: fields[i + 1] ?? "", to: fields[i + 2] ?? "" });
      i += 3;
    } else {
      i += status === "" ? 1 : 2;
    }
  }
  return pairs;
}

export function allowanceFrom(base: Tree): Counts | string {
  const text = base.read(BASELINE_PATH);
  if (text !== null) return parseBaseline(text) ?? `base ${BASELINE_PATH} is not a valid baseline`;
  if (base.read(CHECKER_PATH) !== null) return `base has the checker but no ${BASELINE_PATH}`;
  return measure(base);
}

export function followRenames(input: RatchetInput, allowance: Counts): Counts {
  const inBase = new Set(input.base.list());
  const left = new Map(Object.entries(allowance).filter(([path]) => !input.present.has(path)));
  const followed = { ...allowance };
  for (const { from, to } of input.pairs) {
    if (inBase.has(to)) continue;
    const need = (input.current[to] ?? 0) - (followed[to] ?? 0);
    const take = Math.min(need, left.get(from) ?? 0);
    if (take <= 0) continue;
    followed[to] = (followed[to] ?? 0) + take;
    left.set(from, (left.get(from) ?? 0) - take);
  }
  return followed;
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
  const fromBase = allowanceFrom(input.base);
  if (typeof fromBase === "string") return [fromBase];
  const allowance = followRenames(input, fromBase);
  const errors = [
    ...overAllowance(input.current, allowance, "new cast"),
    ...overAllowance(committed, allowance, "baseline raised"),
  ];
  if (errors.length === 0 && serializeBaseline(input.current) !== input.committed) {
    errors.push(`${BASELINE_PATH} is stale; run \`bun run check:casts:update\` and commit it`);
  }
  return errors;
}
