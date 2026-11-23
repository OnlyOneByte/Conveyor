import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASELINE_PATH } from "./lines/baseline";

const ROOT = join(import.meta.dir, "..", "..");

const runChecker = (args: string[], env: Record<string, string | undefined>) =>
  Bun.spawnSync(["bun", join(import.meta.dir, "lines.ts"), ...args], {
    cwd: ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

describe("check:lines", () => {
  test("--update refuses to run under CI and leaves the baseline untouched", () => {
    const before = readFileSync(join(ROOT, BASELINE_PATH), "utf8");
    const result = runChecker(["--update"], { ...process.env, CI: "true" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("--update is local only");
    expect(readFileSync(join(ROOT, BASELINE_PATH), "utf8")).toBe(before);
  });

  test("a base ref that does not resolve fails instead of allowing nothing", () => {
    const result = runChecker(["--base", "refs/heads/no-such-branch-for-lines"], process.env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "base refs/heads/no-such-branch-for-lines does not resolve to a commit",
    );
  });
});
