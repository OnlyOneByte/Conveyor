import { join } from "node:path";
import { parseArgs } from "node:util";
import { treeAt, workingTree } from "./comments/tree";
import { measure, overLimit } from "./lines/count";
import { checkRatchet } from "./lines/ratchet";

const ROOT = join(import.meta.dir, "..", "..");

const check = (baseRef: string) => {
  const base = treeAt(ROOT, baseRef);
  if (base.list().length === 0) {
    console.error(`base ${baseRef} does not resolve to a commit`);
    return 1;
  }
  const current = measure(workingTree(ROOT));
  console.log(`files over the limit: ${Object.keys(overLimit(current)).length} (base ${baseRef})`);
  const { errors } = checkRatchet({ current, base });
  for (const error of errors) console.error(error);
  return errors.length === 0 ? 0 : 1;
};

function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: { base: { type: "string", default: "origin/main" } },
  });
  return check(values.base);
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
