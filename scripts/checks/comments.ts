import { join } from "node:path";
import { parseArgs } from "node:util";
import { totals } from "./comments/baseline";
import { EXEMPTIONS } from "./comments/exemptions";
import { checkRatchet } from "./comments/ratchet";
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

const check = (tree: Tree, baseRef: string) => {
  const base = treeAt(ROOT, baseRef);
  if (base.list().length === 0) {
    console.error(`base ${baseRef} does not resolve to a commit`);
    return 1;
  }
  const current = measure(tree);
  const sum = totals(current);
  console.log(
    `comment lines: ${sum.comments}, suppressions: ${sum.suppressions} (base ${baseRef})`,
  );
  const { errors } = checkRatchet({ current, present: new Set(tree.list()), base });
  for (const error of errors) console.error(error);
  return errors.length === 0 ? 0 : 1;
};

const strict = (tree: Tree) => {
  printStrict(tree);
  const sum = totals(measure(tree));
  console.log(
    `comment lines: ${sum.comments}, suppressions: ${sum.suppressions} (strict: 0 allowed)`,
  );
  for (const e of EXEMPTIONS) console.log(`exempt: ${e.name}, ${e.where}`);
  return sum.comments === 0 && sum.suppressions === 0 ? 0 : 1;
};

function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      strict: { type: "boolean", default: false },
      base: { type: "string", default: "origin/main" },
    },
  });
  const tree = workingTree(ROOT);
  if (values.strict) return strict(tree);
  return check(tree, values.base);
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
