import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { measure } from "./casts/count";
import { BASELINE_PATH, checkRatchet } from "./casts/ratchet";
import { updateRefusal } from "./comments/ratchet";
import { treeAt, workingTree } from "./comments/tree";
import { serializeBaseline } from "./lines/baseline";

const ROOT = join(import.meta.dir, "..", "..");

const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

const update = () => {
  const refusal = updateRefusal(process.env);
  if (refusal !== null) {
    console.error(refusal);
    return 1;
  }
  const counts = measure(workingTree(ROOT));
  writeFileSync(join(ROOT, BASELINE_PATH), serializeBaseline(counts));
  console.log(
    `wrote ${BASELINE_PATH}: ${total(counts)} casts in ${Object.keys(counts).length} files`,
  );
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
  console.log(`\`as\` casts: ${total(current)} (base ${baseRef})`);
  const errors = checkRatchet({ current, committed: tree.read(BASELINE_PATH), base });
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
