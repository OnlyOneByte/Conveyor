import { z } from "zod";
import type { Sizes } from "./measure";

export const BUDGET_PATH = "scripts/checks/bundle/budget.json";
export const PRECACHE_GROWTH = 1.1;

export interface Budget {
  initialJsGzip: Record<string, number>;
  precache: Sizes;
}

export interface Measured {
  initialJs: Record<string, Sizes & { three: boolean }>;
  precache: Sizes & { missing: string[] };
}

const size = z.number().positive().finite();

const budgetSchema = z.object({
  initialJsGzip: z.record(z.string(), size),
  precache: z.object({ raw: size, gzip: size }),
});

export function parseBudget(text: string): Budget {
  const parsed = budgetSchema.safeParse(JSON.parse(text));
  if (!parsed.success)
    throw new Error(`${BUDGET_PATH} isn't a valid budget: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

const SIZE_KEYS: (keyof Sizes)[] = ["raw", "gzip"];

const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} KB`;

export function budgetErrors(measured: Measured, budget: Budget): string[] {
  const errors: string[] = [];
  for (const [route, sizes] of Object.entries(measured.initialJs)) {
    if (sizes.three)
      errors.push(
        `${route}: three.js is in the initial JS; load it with import() when a canvas mounts`,
      );
    const limit = budget.initialJsGzip[route];
    if (limit !== undefined && sizes.gzip > limit)
      errors.push(`${route}: initial JS is ${kb(sizes.gzip)} gzip, over the ${kb(limit)} budget`);
  }
  for (const path of measured.precache.missing)
    errors.push(
      `service-worker precache leaves out ${path}; the app needs every immutable .js and .css offline`,
    );
  for (const key of SIZE_KEYS) {
    const limit = Math.floor(budget.precache[key] * PRECACHE_GROWTH);
    if (measured.precache[key] > limit)
      errors.push(
        `service-worker precache is ${kb(measured.precache[key])} ${key}, more than 10% over the committed ${kb(budget.precache[key])}; run \`bun run check:bundle:update\` if the growth is wanted`,
      );
  }
  return errors;
}
