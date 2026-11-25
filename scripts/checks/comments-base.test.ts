import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, sh } from "./test-repo";

const scratch = mkdtempSync(join(tmpdir(), "conveyor-comments-base-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const CHECKS = (root: string) => join(root, "scripts", "checks");

function staleMergeRepo() {
  const root = mkdtempSync(join(scratch, "repo-"));
  mkdirSync(CHECKS(root), { recursive: true });
  cpSync(import.meta.dir, CHECKS(root), {
    recursive: true,
    filter: (path) =>
      !/\/coverage(\/|$)|\/lines(\/|$)|\.test\.ts$/.test(path.slice(import.meta.dir.length)),
  });
  sh(root, ["git", "init", "-q", "-b", "main"]);
  const oldMain = commit(
    root,
    { "a.ts": "// kept until main drops it\nexport const a = 1;\n" },
    "old main",
  );
  sh(root, ["git", "switch", "-q", "-c", "feature"]);
  commit(root, { "feature.ts": "export const f = 1;\n" }, "feature");
  sh(root, ["git", "switch", "-q", "main"]);
  const tip = commit(root, { "a.ts": "export const a = 1;\n" }, "main drops the comment");
  sh(root, ["git", "switch", "-q", "--detach", oldMain]);
  sh(root, ["git", "merge", "-q", "--no-edit", "feature"]);
  return { root, oldMain, tip };
}

describe("the comment ratchet on a merge commit built on an older main", () => {
  test("passes against the merge's first parent and fails against main's newer tip", () => {
    const { root, oldMain, tip } = staleMergeRepo();
    const base = sh(root, ["bun", join(CHECKS(root), "base.ts")], {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REF: "refs/pull/1/merge",
    });
    expect(base).toMatchObject({ code: 0, out: oldMain });
    const comments = join(CHECKS(root), "comments.ts");
    expect(sh(root, ["bun", comments, "--base", base.out]).code).toBe(0);
    const againstTip = sh(root, ["bun", comments, "--base", tip]);
    expect(againstTip.code).toBe(1);
    expect(againstTip.err).toContain("added: a.ts: 1 comments (base allows 0)");
  }, 60_000);
});
