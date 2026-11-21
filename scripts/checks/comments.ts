import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { serializeBaseline, totals } from "./comments/baseline";
import { BASELINE_PATH, checkRatchet } from "./comments/ratchet";
import { commentLines, languageOf } from "./comments/tally";
import { measure, type Tree, treeAt, workingTree } from "./comments/tree";

const ROOT = join(import.meta.dir, "..", "..");

const printStrict = (tree: Tree) => {
  for (const path of tree.list().sort()) {
    const language = languageOf(path);
    const src = language ? tree.read(path) : null;
    if (!language || src === null) continue;
    for (const line of commentLines(src, language)) console.error(`${path}:${line}`);
  }
};

const update = (tree: Tree) => {
  if (process.env.CI) {
    console.error("--update is local only; commit the regenerated baseline instead");
    return 1;
  }
  const current = measure(tree);
  writeFileSync(join(ROOT, BASELINE_PATH), serializeBaseline(current));
  const sum = totals(current);
  console.log(`wrote baseline: ${sum.comments} comment lines, ${sum.suppressions} suppressions`);
  return 0;
};

const check = (tree: Tree, baseRef: string) => {
  const current = measure(tree);
  const sum = totals(current);
  console.log(
    `comment lines: ${sum.comments}, suppressions: ${sum.suppressions} (base ${baseRef})`,
  );
  const { errors } = checkRatchet({
    current,
    present: new Set(tree.list()),
    committed: tree.read(BASELINE_PATH),
    base: treeAt(ROOT, baseRef),
  });
  for (const error of errors) console.error(error);
  return errors.length === 0 ? 0 : 1;
};

const strict = (tree: Tree) => {
  printStrict(tree);
  const sum = totals(measure(tree));
  console.log(`comment lines: ${sum.comments} (strict: 0 allowed)`);
  return sum.comments === 0 ? 0 : 1;
};

function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      update: { type: "boolean", default: false },
      strict: { type: "boolean", default: false },
      base: { type: "string", default: "origin/main" },
    },
  });
  const tree = workingTree(ROOT);
  if (values.update) return update(tree);
  if (values.strict) return strict(tree);
  return check(tree, values.base);
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
