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

const isSize = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const recordOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : null;

export function parseBudget(text: string): Budget | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const budget = recordOf(value);
  const limits = recordOf(budget?.initialJsGzip);
  const precache = recordOf(budget?.precache);
  if (!limits || !precache) return null;
  const initialJsGzip: Record<string, number> = {};
  for (const [route, limit] of Object.entries(limits)) {
    if (!isSize(limit)) return null;
    initialJsGzip[route] = limit;
  }
  const { raw, gzip } = precache;
  return isSize(raw) && isSize(gzip) ? { initialJsGzip, precache: { raw, gzip } } : null;
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
