import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  BUDGET_PATH,
  budgetErrors,
  loosenedErrors,
  type Measured,
  parseBudget,
} from "./bundle/budget";
import { initialJs, precache, routesOf } from "./bundle/measure";
import { updateRefusal } from "./comments/ratchet";
import { treeAt } from "./comments/tree";

const ROOT = join(import.meta.dir, "..", "..");
const OUTPUT = join(ROOT, "packages/web/.svelte-kit/output");

const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} KB`;

function measured(): Measured {
  const routes = Object.fromEntries(
    routesOf(OUTPUT).map((route) => [route, initialJs(OUTPUT, route)]),
  );
  const { raw, gzip, files, missing } = precache(OUTPUT);
  for (const [route, sizes] of Object.entries(routes))
    console.log(`${route}: initial JS ${kb(sizes.gzip)} gzip`);
  console.log(`precache: ${files} files, ${kb(raw)} raw, ${kb(gzip)} gzip`);
  return { initialJs: routes, precache: { raw, gzip, missing } };
}

function baseErrors(baseRef: string, current: string): string[] {
  const base = treeAt(ROOT, baseRef);
  if (base.list().length === 0) return [`base ${baseRef} does not resolve to a commit`];
  const committed = base.read(BUDGET_PATH);
  if (committed === null) {
    console.log(`${BUDGET_PATH} is new on ${baseRef}; nothing to compare it with`);
    return [];
  }
  return loosenedErrors(parseBudget(current), parseBudget(committed));
}

function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      update: { type: "boolean", default: false },
      base: { type: "string", default: "origin/main" },
    },
  });
  const text = readFileSync(join(ROOT, BUDGET_PATH), "utf8");
  const budget = parseBudget(text);
  const now = measured();
  if (values.update) {
    const refusal = updateRefusal(process.env);
    if (refusal !== null) {
      console.error(refusal);
      return 1;
    }
    const { raw, gzip } = now.precache;
    writeFileSync(
      join(ROOT, BUDGET_PATH),
      `${JSON.stringify({ ...budget, precache: { raw, gzip } }, null, 2)}\n`,
    );
    console.log(`wrote ${BUDGET_PATH}`);
    return 0;
  }
  const errors = [...budgetErrors(now, budget), ...baseErrors(values.base, text)];
  for (const error of errors) console.error(error);
  return errors.length === 0 ? 0 : 1;
}

process.exit(main(process.argv.slice(2)));
