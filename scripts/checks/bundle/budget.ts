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

function routeSetErrors(routes: string[], budget: Budget): string[] {
  const errors: string[] = [];
  if (routes.length === 0)
    errors.push(
      "found no page routes in the server manifest, so nothing was checked; has SvelteKit's format changed?",
    );
  if (budget.initialJsGzip["/"] === undefined)
    errors.push(`${BUDGET_PATH} has no initial JS budget for /`);
  for (const route of Object.keys(budget.initialJsGzip))
    if (!routes.includes(route))
      errors.push(`${BUDGET_PATH} budgets ${route}, but the build has no such route`);
  return errors;
}

function routeErrors(measured: Measured, budget: Budget): string[] {
  return Object.entries(measured.initialJs).flatMap(([route, sizes]) => {
    const limit = budget.initialJsGzip[route];
    return [
      ...(sizes.three
        ? [`${route}: three.js is in the initial JS; load it with import() when a canvas mounts`]
        : []),
      ...(limit !== undefined && sizes.gzip > limit
        ? [`${route}: initial JS is ${kb(sizes.gzip)} gzip, over the ${kb(limit)} budget`]
        : []),
    ];
  });
}

function precacheErrors(measured: Measured, budget: Budget): string[] {
  const missing = measured.precache.missing.map(
    (path) =>
      `service-worker precache leaves out ${path}; the app needs every immutable .js and .css offline`,
  );
  const grown = SIZE_KEYS.filter(
    (key) => measured.precache[key] > Math.floor(budget.precache[key] * PRECACHE_GROWTH),
  ).map(
    (key) =>
      `service-worker precache is ${kb(measured.precache[key])} ${key}, more than 10% over the committed ${kb(budget.precache[key])}; run \`bun run check:bundle:update\` if the growth is wanted`,
  );
  return [...missing, ...grown];
}

export const budgetErrors = (measured: Measured, budget: Budget): string[] => [
  ...routeSetErrors(Object.keys(measured.initialJs), budget),
  ...routeErrors(measured, budget),
  ...precacheErrors(measured, budget),
];

export function loosenedErrors(budget: Budget, base: Budget): string[] {
  const errors: string[] = [];
  for (const [route, limit] of Object.entries(base.initialJsGzip)) {
    const now = budget.initialJsGzip[route];
    if (now === undefined)
      errors.push(`${BUDGET_PATH} drops the ${route} budget the base has (${kb(limit)})`);
    else if (now > limit)
      errors.push(`${BUDGET_PATH} raises the ${route} budget from ${kb(limit)} to ${kb(now)}`);
  }
  for (const key of SIZE_KEYS) {
    const limit = Math.floor(base.precache[key] * PRECACHE_GROWTH);
    if (budget.precache[key] > limit)
      errors.push(
        `${BUDGET_PATH} raises the precache ${key} from ${kb(base.precache[key])} to ${kb(budget.precache[key])}, more than 10% in one change`,
      );
  }
  return errors;
}
