import { z } from "zod";
import type { RouteJs, Sizes } from "./measure";

export const BUDGET_PATH = "scripts/checks/bundle/budget.json";
export const PRECACHE_GROWTH = 1.1;

export interface Budget {
  initialJsGzip: Record<string, number>;
  precache: Sizes;
}

export interface Measured {
  initialJs: Record<string, RouteJs>;
  precache: Sizes & { missing: string[]; editor: string[]; editorKept: string[] };
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
    const errors: string[] = [];
    if (sizes.three)
      errors.push(
        `${route}: three.js is in the initial JS; load it with import() when a canvas mounts`,
      );
    if (sizes.zod)
      errors.push(`${route}: Zod is in the initial JS; import the Zod-free shared modules instead`);
    if (sizes.evals)
      errors.push(
        `${route}: the initial JS builds code at runtime (Function, eval or a function's constructor), which the strict CSP refuses`,
      );
    if (limit === undefined)
      errors.push(
        `${route}: no initial JS budget; add it to ${BUDGET_PATH} (about 10% over its ${kb(sizes.gzip)} gzip today)`,
      );
    else if (sizes.gzip > limit)
      errors.push(`${route}: initial JS is ${kb(sizes.gzip)} gzip, over the ${kb(limit)} budget`);
    return errors;
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
  return [...missing, ...editorErrors(measured.precache), ...grown];
}

export function editorErrors({ editor, editorKept }: Measured["precache"]): string[] {
  if (editor.length === 0)
    return [
      "found no profile editor chunk (CodeMirror reached only through import()); has the build changed?",
    ];
  return editorKept.map(
    (path) =>
      `service-worker precache keeps ${path}, the profile editor's code; it loads on demand`,
  );
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
