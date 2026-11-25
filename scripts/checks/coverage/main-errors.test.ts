import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { ROOT } from "./runner";

const scratch = mkdtempSync(join(tmpdir(), "conveyor-main-errors-test-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SLOW = 60_000;
const lcov = join(scratch, "lcov.info");
const out = join(scratch, "merged.lcov");
writeFileSync(lcov, "");

const check = (args: string[], env: Record<string, string>) => {
  const { GITHUB_ACTIONS: _ci, CI: _local, ...rest } = process.env;
  const result = Bun.spawnSync(
    ["bun", "scripts/checks/coverage/main.ts", "--out", relative(ROOT, out), ...args],
    { cwd: ROOT, env: { ...rest, ...env }, stdout: "pipe", stderr: "pipe" },
  );
  return { code: result.exitCode, text: `${result.stdout}${result.stderr}` };
};

const ACTIONS = { GITHUB_ACTIONS: "true" };

describe("check:coverage's early exits", () => {
  test("a missing lcov is annotated under GitHub Actions, and plain without it", () => {
    const missing = relative(ROOT, join(scratch, "absent.lcov"));
    const annotated = check(["--lcov", missing], ACTIONS);
    expect(annotated.code).toBe(1);
    expect(annotated.text).toContain(`::error::${missing} not found;`);
    const plain = check(["--lcov", missing], {});
    expect(plain.code).toBe(1);
    expect(plain.text).toContain(`${missing} not found;`);
    expect(plain.text).not.toContain("::error::");
  });

  test(
    "a base ref that doesn't resolve is annotated",
    () => {
      const result = check(["--lcov", relative(ROOT, lcov), "--base", "no-such-ref"], ACTIONS);
      expect(result.code).toBe(1);
      expect(result.text).toContain(
        "::error::base ref no-such-ref does not resolve; fetch it first",
      );
    },
    SLOW,
  );

  test(
    "an --update under CI is refused with an annotation",
    () => {
      const result = check(["--lcov", relative(ROOT, lcov), "--update"], {
        ...ACTIONS,
        CI: "true",
      });
      expect(result.code).toBe(1);
      expect(result.text).toContain("::error::--update is local only;");
    },
    SLOW,
  );
});
