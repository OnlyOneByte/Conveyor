import { join } from "node:path";
import { parseArgs } from "node:util";
import { measure } from "./casts/count";
import { checkRatchet, parsePairs } from "./casts/ratchet";
import { treeAt, workingTree } from "./comments/tree";

const ROOT = join(import.meta.dir, "..", "..");

const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

const check = (baseRef: string) => {
  const base = treeAt(ROOT, baseRef);
  if (base.list().length === 0) {
    console.error(`base ${baseRef} does not resolve to a commit`);
    return 1;
  }
  const tree = workingTree(ROOT);
  const current = measure(tree);
  console.log(`\`as\` casts: ${total(current)} (base ${baseRef})`);
  const present = new Set(tree.list());
  const diff = Bun.spawnSync(["git", "diff", "-M", "-C", "-z", "--name-status", baseRef], {
    cwd: ROOT,
  });
  const pairs = diff.exitCode === 0 ? parsePairs(diff.stdout.toString()) : [];
  const errors = checkRatchet({ current, base, present, pairs });
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
