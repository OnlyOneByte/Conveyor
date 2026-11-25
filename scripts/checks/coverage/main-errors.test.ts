import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { baselinePath } from "./ratchet";
import { ROOT } from "./runner";
import { PACKAGES } from "./summary";

const scratch = mkdtempSync(join(tmpdir(), "conveyor-main-errors-test-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SLOW = 60_000;
const lcov = join(scratch, "lcov.info");
const out = join(scratch, "merged.lcov");
writeFileSync(lcov, "");

const childEnv = (inherited: Record<string, string | undefined>) =>
  Object.fromEntries(
    Object.entries(inherited).filter(([key]) => key !== "CI" && !key.startsWith("GITHUB_")),
  );

const check = (args: string[], env: Record<string, string>, inherited = process.env) => {
  const result = Bun.spawnSync(
    ["bun", "scripts/checks/coverage/main.ts", "--out", relative(ROOT, out), ...args],
    { cwd: ROOT, env: { ...childEnv(inherited), ...env }, stdout: "pipe", stderr: "pipe" },
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
    "an --update under CI is refused with an annotation, and no baseline is written",
    () => {
      const baselines = PACKAGES.map((name) => join(ROOT, baselinePath(name)));
      const before = baselines.map((path) => readFileSync(path, "utf8"));
      const result = check(["--lcov", relative(ROOT, lcov), "--update"], {
        ...ACTIONS,
        CI: "true",
      });
      expect(result.code).toBe(1);
      expect(result.text).toContain("::error::--update is local only;");
      expect(baselines.map((path) => readFileSync(path, "utf8"))).toEqual(before);
    },
    SLOW,
  );

  test(
    "a child check never writes to the job summary of the run that tests it",
    () => {
      const summary = join(scratch, "step-summary.md");
      writeFileSync(summary, "");
      const inherited = { ...process.env, GITHUB_STEP_SUMMARY: summary, GITHUB_ACTIONS: "true" };
      const result = check(
        ["--lcov", relative(ROOT, lcov), "--base", "no-such-ref"],
        {},
        inherited,
      );
      expect(result.code).toBe(1);
      expect(result.text).toContain("### Line coverage");
      expect(readFileSync(summary, "utf8")).toBe("");
    },
    SLOW,
  );
});
