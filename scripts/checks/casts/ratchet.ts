import type { Tree } from "../comments/tree";
import type { Counts } from "../lines/count";
import { measure } from "./count";

export interface RatchetInput {
  current: Counts;
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

export function checkRatchet(input: RatchetInput): string[] {
  const allowance = followRenames(input, measure(input.base));
  return Object.entries(input.current).flatMap(([path, casts]) => {
    const allowed = allowance[path] ?? 0;
    if (casts <= allowed) return [];
    return [
      `new cast: ${path}: ${casts} \`as\` casts (base allows ${allowed}); parse the value instead`,
    ];
  });
}
