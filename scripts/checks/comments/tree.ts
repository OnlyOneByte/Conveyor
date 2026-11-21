import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Baseline } from "./baseline";
import { languageOf, tallyFile } from "./tally";

export interface Tree {
  list: () => string[];
  read: (path: string) => string | null;
}

const git = (root: string, args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd: root });
  return result.exitCode === 0 ? result.stdout.toString() : null;
};

const splitNul = (text: string | null) => (text ?? "").split("\0").filter(Boolean);

export const workingTree = (root: string): Tree => ({
  list: () => splitNul(git(root, ["ls-files", "-z"])),
  read: (path) => {
    const full = join(root, path);
    return existsSync(full) ? readFileSync(full, "utf8") : null;
  },
});

export const treeAt = (root: string, ref: string): Tree => ({
  list: () => splitNul(git(root, ["ls-tree", "-r", "-z", "--name-only", ref])),
  read: (path) => git(root, ["show", `${ref}:${path}`]),
});

export function measure(tree: Tree): Baseline {
  const files: Baseline["files"] = {};
  for (const path of tree.list().sort()) {
    const language = languageOf(path);
    const src = language ? tree.read(path) : null;
    if (!language || src === null) continue;
    files[path] = tallyFile(src, language);
  }
  return { files };
}
