import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, sh } from "../test-repo";
import { treeAt } from "./tree";

const scratch = mkdtempSync(join(tmpdir(), "conveyor-tree-test-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("a tree at a commit reads every file in one batch, as that commit had it", () => {
  sh(scratch, ["git", "init", "-q", "-b", "main"]);
  mkdirSync(join(scratch, "sub dir"));
  const files = {
    "a.ts": "export const a = 1;\n",
    "sub dir/b c.ts": "line one\nline two\n",
    "empty.ts": "",
    "é.ts": "// ünïcode\n",
  };
  const first = commit(scratch, files, "first");
  commit(scratch, { "a.ts": "export const a = 2;\n" }, "second");
  const tree = treeAt(scratch, first);
  expect(tree.list().sort()).toEqual(Object.keys(files).sort());
  for (const [path, text] of Object.entries(files)) expect(tree.read(path)).toBe(text);
  expect(tree.read("missing.ts")).toBeNull();
});
