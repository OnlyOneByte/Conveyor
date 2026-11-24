import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BUDGET_PATH, budgetErrors, type Measured, parseBudget } from "./bundle/budget";
import { initialJs, precache, routesOf } from "./bundle/measure";
import { updateRefusal } from "./comments/ratchet";

const ROOT = join(import.meta.dir, "..", "..");
const OUTPUT = join(ROOT, "packages/web/.svelte-kit/output");
const STATIC = join(ROOT, "packages/web/static");

const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} KB`;

function measured(): Measured {
  const routes = Object.fromEntries(
    routesOf(OUTPUT).map((route) => [route, initialJs(OUTPUT, route)]),
  );
  const { raw, gzip, files, missing } = precache(OUTPUT, STATIC);
  for (const [route, sizes] of Object.entries(routes))
    console.log(`${route}: initial JS ${kb(sizes.gzip)} gzip`);
  console.log(`precache: ${files} files, ${kb(raw)} raw, ${kb(gzip)} gzip`);
  return { initialJs: routes, precache: { raw, gzip, missing } };
}

function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: { update: { type: "boolean", default: false } },
  });
  const budget = parseBudget(readFileSync(join(ROOT, BUDGET_PATH), "utf8"));
  if (!budget) {
    console.error(
      `${BUDGET_PATH} isn't a valid budget: initialJsGzip and precache need positive numbers`,
    );
    return 1;
  }
  const now = measured();
  if (values.update) {
    const refusal = updateRefusal(process.env);
    if (refusal !== null) {
      console.error(refusal);
      return 1;
    }
    writeFileSync(
      join(ROOT, BUDGET_PATH),
      `${JSON.stringify({ ...budget, precache: now.precache }, null, 2)}\n`,
    );
    console.log(`wrote ${BUDGET_PATH}`);
    return 0;
  }
  const errors = budgetErrors(now, budget);
  for (const error of errors) console.error(error);
  return errors.length === 0 ? 0 : 1;
}

process.exit(main(process.argv.slice(2)));
