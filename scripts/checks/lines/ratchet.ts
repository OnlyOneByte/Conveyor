import type { Tree } from "../comments/tree";
import { type Counts, limitOf, measure } from "./count";

export interface RatchetInput {
  current: Counts;
  base: Tree;
}

export interface RatchetResult {
  errors: string[];
}

export function checkRatchet({ current, base }: RatchetInput): RatchetResult {
  const allowance = measure(base);
  const errors = Object.entries(current).flatMap(([path, lines]) => {
    const allowed = allowance[path] ?? 0;
    const limit = limitOf(path);
    if (lines <= Math.max(limit, allowed)) return [];
    const against = allowed > limit ? `base allows ${allowed}` : `limit ${limit}`;
    return [`too long: ${path}: ${lines} lines (${against})`];
  });
  return { errors };
}
