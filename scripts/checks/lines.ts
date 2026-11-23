import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { updateRefusal } from "./comments/ratchet";
import { treeAt, workingTree } from "./comments/tree";
import { BASELINE_PATH, serializeBaseline } from "./lines/baseline";
import { measure, overLimit } from "./lines/count";
import { checkRatchet } from "./lines/ratchet";

const ROOT = join(import.meta.dir, "..", "..");

const update = () => {
  const refusal = updateRefusal(process.env);
  if (refusal !== null) {
    console.error(refusal);
    return 1;
  }
  const over = overLimit(measure(workingTree(ROOT)));
  writeFileSync(join(ROOT, BASELINE_PATH), serializeBaseline(over));
  console.log(`wrote ${BASELINE_PATH}: ${Object.keys(over).length} files over the limit`);
  return 0;
};

const check = (baseRef: string) => {
  const base = treeAt(ROOT, baseRef);
  if (base.list().length === 0) {
    console.error(`base ${baseRef} does not resolve to a commit`);
    return 1;
  }
  const tree = workingTree(ROOT);
  const current = measure(tree);
  console.log(`files over the limit: ${Object.keys(overLimit(current)).length} (base ${baseRef})`);
  const { errors } = checkRatchet({ current, committed: tree.read(BASELINE_PATH), base });
  for (const error of errors) console.error(error);
  return errors.length === 0 ? 0 : 1;
};

function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      update: { type: "boolean", default: false },
      base: { type: "string", default: "origin/main" },
    },
  });
  return values.update ? update() : check(values.base);
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
