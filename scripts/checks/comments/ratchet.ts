import { type Baseline, type Excess, excesses } from "./baseline";
import { measure, type Tree } from "./tree";

export interface RatchetInput {
  current: Baseline;
  present: ReadonlySet<string>;
  base: Tree;
}

export interface RatchetResult {
  errors: string[];
}

const describe = (excess: Excess) =>
  `added: ${excess.file}: ${excess.actual} ${excess.metric} (base allows ${excess.allowed})`;

export const updateRefusal = (env: Record<string, string | undefined>): string | null =>
  env.CI ? "--update is local only; commit the regenerated baseline instead" : null;

export function checkRatchet({ current, present, base }: RatchetInput): RatchetResult {
  const added = excesses({ actual: current, allowed: measure(base), present });
  return { errors: added.map(describe) };
}
