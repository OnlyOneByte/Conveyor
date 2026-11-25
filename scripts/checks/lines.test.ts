import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

const runChecker = (args: string[]) =>
  Bun.spawnSync(["bun", join(import.meta.dir, "lines.ts"), ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });

describe("check:lines", () => {
  test("a base ref that does not resolve fails instead of allowing nothing", () => {
    const result = runChecker(["--base", "refs/heads/no-such-branch-for-lines"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "base refs/heads/no-such-branch-for-lines does not resolve to a commit",
    );
  });
});
