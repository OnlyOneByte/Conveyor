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

const BLOB_ENTRY = /^\d+ blob ([0-9a-f]+)\t(.*)$/s;

function readBlobs(root: string, ref: string): Map<string, string> {
  const entries = splitNul(git(root, ["ls-tree", "-r", "-z", ref])).flatMap((entry) => {
    const match = BLOB_ENTRY.exec(entry);
    return match?.[1] && match[2] !== undefined ? [{ oid: match[1], path: match[2] }] : [];
  });
  const stdin = Buffer.from(entries.map(({ oid }) => `${oid}\n`).join(""));
  const out = Bun.spawnSync(["git", "cat-file", "--batch"], { cwd: root, stdin }).stdout;
  const blobs = new Map<string, string>();
  let at = 0;
  for (const { path } of entries) {
    const end = out.indexOf(10, at);
    if (end === -1) break;
    const [, type, size] = out.subarray(at, end).toString().split(" ");
    at = end + 1;
    if (type !== "blob") continue;
    blobs.set(path, out.subarray(at, at + Number(size)).toString());
    at += Number(size) + 1;
  }
  return blobs;
}

export const treeAt = (root: string, ref: string): Tree => {
  let blobs: Map<string, string> | null = null;
  return {
    list: () => splitNul(git(root, ["ls-tree", "-r", "-z", "--name-only", ref])),
    read: (path) => {
      blobs ??= readBlobs(root, ref);
      return blobs.get(path) ?? null;
    },
  };
};

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
