import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CHECKER = join(import.meta.dir, "comments.ts");

describe("check:comments --update", () => {
  test("refuses to run under CI", () => {
    const result = Bun.spawnSync(["bun", CHECKER, "--update"], {
      env: { ...process.env, CI: "true" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("--update is local only");
    expect(result.stdout.toString()).not.toContain("wrote");
  }, 60_000);
});
