import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Git, pullRequestBase } from "./base";
import { BASELINE_PATH, serializeBaseline } from "./lines/baseline";
import { commit, sh } from "./test-repo";

const scratch = mkdtempSync(join(tmpdir(), "conveyor-base-test-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const recording = (answer: string | null) => {
  const calls: string[][] = [];
  const run: Git = (args) => {
    calls.push(args);
    return answer;
  };
  return { calls, run };
};

describe("pullRequestBase", () => {
  test("a pull request compares with its merge commit's first parent", () => {
    const git = recording("abc");
    expect(pullRequestBase({ event: "pull_request", ref: "refs/pull/7/merge" }, git.run)).toBe(
      "abc",
    );
    expect(git.calls).toEqual([["rev-parse", "HEAD^1"]]);
  });

  test("a manual run on another branch compares with its merge base on main", () => {
    const git = recording("def");
    expect(pullRequestBase({ event: "workflow_dispatch", ref: "refs/heads/x" }, git.run)).toBe(
      "def",
    );
    expect(git.calls).toEqual([["merge-base", "origin/main", "HEAD"]]);
  });

  test("a push, or a manual run on main, has no pull request base", () => {
    const git = recording("unused");
    expect(pullRequestBase({ event: "push", ref: "refs/heads/main" }, git.run)).toBe("");
    expect(pullRequestBase({ event: "workflow_dispatch", ref: "refs/heads/main" }, git.run)).toBe(
      "",
    );
    expect(git.calls).toEqual([]);
  });

  test("a git failure is an error, not an empty base", () => {
    expect(pullRequestBase({ event: "pull_request", ref: "" }, recording(null).run)).toBeNull();
  });
});

function staleMergeRepo() {
  const root = mkdtempSync(join(scratch, "repo-"));
  mkdirSync(join(root, "scripts", "checks"), { recursive: true });
  cpSync(import.meta.dir, join(root, "scripts", "checks"), {
    recursive: true,
    filter: (path) =>
      !/\/coverage(\/|$)|\.test\.ts$|\/baseline(\/|$)|baseline\.json$/.test(
        path.slice(import.meta.dir.length),
      ),
  });
  sh(root, ["git", "init", "-q", "-b", "main"]);
  const big = "x\n".repeat(300);
  const oldMain = commit(
    root,
    { "big.ts": big, [BASELINE_PATH]: serializeBaseline({ "big.ts": 300 }) },
    "old main",
  );
  sh(root, ["git", "switch", "-q", "-c", "feature"]);
  commit(root, { "feature.ts": "export const f = 1;\n" }, "feature");
  sh(root, ["git", "switch", "-q", "main"]);
  const tip = commit(
    root,
    { "big.ts": "x\n".repeat(240), [BASELINE_PATH]: serializeBaseline({}) },
    "main shrinks big.ts",
  );
  sh(root, ["git", "switch", "-q", "--detach", oldMain]);
  sh(root, ["git", "merge", "-q", "--no-edit", "feature"]);
  return { root, oldMain, tip };
}

describe("the file-size check on a merge commit built on an older main", () => {
  test("passes against the merge's first parent and fails against main's newer tip", () => {
    const { root, oldMain, tip } = staleMergeRepo();
    const base = sh(root, ["bun", join(root, "scripts", "checks", "base.ts")], {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REF: "refs/pull/1/merge",
    });
    expect(base).toMatchObject({ code: 0, out: oldMain });
    const lines = join(root, "scripts", "checks", "lines.ts");
    expect(sh(root, ["bun", lines, "--base", base.out]).code).toBe(0);
    const againstTip = sh(root, ["bun", lines, "--base", tip]);
    expect(againstTip.code).toBe(1);
    expect(againstTip.err).toContain("too long: big.ts: 300 lines (limit 250)");
  }, 60_000);

  test("a push prints the previous commit it was given", () => {
    const { root, oldMain } = staleMergeRepo();
    const base = sh(
      root,
      ["bun", join(root, "scripts", "checks", "base.ts"), "--previous", oldMain],
      {
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: "refs/heads/main",
      },
    );
    expect(base).toMatchObject({ code: 0, out: oldMain });
  }, 60_000);
});
