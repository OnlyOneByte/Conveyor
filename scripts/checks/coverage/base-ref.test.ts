import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, sh } from "../test-repo";
import { baselinePath, CHECKER_PATH, checkRatchet, serializePercent } from "./ratchet";
import { readBase, readCommitted } from "./runner";
import { PACKAGES } from "./summary";

const scratch = mkdtempSync(join(tmpdir(), "conveyor-coverage-base-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const BASE_SCRIPT = join(import.meta.dir, "..", "base.ts");

const baselines = (worker: number) =>
  Object.fromEntries(
    PACKAGES.map((name) => [baselinePath(name), serializePercent(name === "worker" ? worker : 90)]),
  );

function staleMergeRepo() {
  const root = mkdtempSync(join(scratch, "repo-"));
  mkdirSync(join(root, "scripts", "checks", "coverage", "baseline"), { recursive: true });
  sh(root, ["git", "init", "-q", "-b", "main"]);
  const oldMain = commit(
    root,
    { [CHECKER_PATH]: "export {};\n", ...baselines(80) },
    "old main, worker at 80%",
  );
  sh(root, ["git", "switch", "-q", "-c", "feature"]);
  commit(root, { "feature.ts": "export const f = 1;\n" }, "feature");
  sh(root, ["git", "switch", "-q", "main"]);
  const tip = commit(root, baselines(85), "main raises the worker floor to 85%");
  sh(root, ["git", "switch", "-q", "--detach", oldMain]);
  sh(root, ["git", "merge", "-q", "--no-edit", "feature"]);
  return { root, oldMain, tip };
}

const current = Object.fromEntries(PACKAGES.map((name) => [name, name === "worker" ? 80.2 : 90]));

function ratchet(root: string, ref: string) {
  const base = readBase(ref, root);
  if (base instanceof Error) throw base;
  return checkRatchet({
    current,
    committed: readCommitted(root),
    base: base.baseline,
    baseHasChecker: base.hasChecker,
  }).errors;
}

describe("the coverage ratchet on a merge commit built on an older main", () => {
  test("passes against the merge's first parent and fails against main's newer tip", () => {
    const { root, oldMain, tip } = staleMergeRepo();
    const base = sh(root, ["bun", BASE_SCRIPT], {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REF: "refs/pull/1/merge",
    });
    expect(base).toMatchObject({ code: 0, out: oldMain });
    expect(ratchet(root, base.out)).toEqual([]);
    expect(ratchet(root, tip)).toContain("worker: line coverage 80.20% dropped below base 85.00%");
  }, 60_000);
});
