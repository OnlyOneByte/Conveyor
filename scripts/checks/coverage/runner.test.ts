import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BASELINE_PATH, CHECKER_PATH } from "./ratchet";
import { readBase, runSweep, sources } from "./runner";
import { SWEEP_TIMEOUT_ENV } from "./summary";

const scratch = mkdtempSync(join(tmpdir(), "conveyor-runner-test-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const fixture = (name: string, source: string) => {
  const path = join(scratch, name);
  writeFileSync(path, source);
  return path;
};

const SLOW = 60_000;

describe("runSweep", () => {
  test(
    "reports imports that throw or exit, and maps the ones that load",
    () => {
      const ok = fixture("ok.ts", "export const one = () => 1;\n");
      const throws = fixture("throws.ts", 'throw new Error("boom");\n');
      const exits = fixture("exits.ts", "process.exit(3);\n");
      const sweep = runSweep([ok, throws, exits]);
      expect(sweep.completed).toBe(true);
      expect(sweep.failed).toEqual([throws, exits]);
      expect([...sweep.coverage.keys()].some((path) => path.endsWith("ok.ts"))).toBe(true);
    },
    SLOW,
  );

  test(
    "a sweep killed before it reports is not completed",
    () => {
      const killer = fixture("killer.ts", 'process.kill(process.pid, "SIGKILL");\n');
      const sweep = runSweep([killer]);
      expect(sweep.completed).toBe(false);
    },
    SLOW,
  );

  test(
    "a hanging import fails the sweep once the configured timeout passes",
    () => {
      const hangs = fixture("hangs.ts", "await new Promise(() => {});\n");
      const previous = process.env[SWEEP_TIMEOUT_ENV];
      process.env[SWEEP_TIMEOUT_ENV] = "500";
      const started = performance.now();
      try {
        expect(runSweep([hangs]).completed).toBe(false);
      } finally {
        if (previous === undefined) delete process.env[SWEEP_TIMEOUT_ENV];
        else process.env[SWEEP_TIMEOUT_ENV] = previous;
      }
      expect(performance.now() - started).toBeLessThan(SLOW / 2);
    },
    SLOW,
  );
});

const repo = (files: Record<string, string>) => {
  const root = mkdtempSync(join(scratch, "repo-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (args: string[]) =>
    Bun.spawnSync(["git", "-c", "commit.gpgsign=false", ...args], {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.invalid",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.invalid",
      },
    });
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "base"]);
  return root;
};

describe("readBase", () => {
  test("detects a base that has the checker but no baseline", () => {
    const root = repo({ [CHECKER_PATH]: "export {};\n" });
    expect(readBase("HEAD", root)).toEqual({ baseline: null, hasChecker: true });
  });

  test("detects a base that predates the checker", () => {
    const root = repo({ "README.md": "x\n" });
    expect(readBase("HEAD", root)).toEqual({ baseline: null, hasChecker: false });
  });

  test("reads the base baseline when it exists", () => {
    const root = repo({ [CHECKER_PATH]: "export {};\n", [BASELINE_PATH]: '{"lines":{}}\n' });
    expect(readBase("HEAD", root)).toEqual({ baseline: '{"lines":{}}\n', hasChecker: true });
  });

  test("an unresolvable base ref is an error", () => {
    const root = repo({ "README.md": "x\n" });
    expect(readBase("no-such-ref", root)).toBeInstanceOf(Error);
  });
});

describe("sources", () => {
  test("lists non-test spec and test-folder modules, not suites or declared helpers", () => {
    const suite = 'import { test } from "bun:test";\ntest("x", () => {});\n';
    const module = "export const one = 1;\n";
    const root = repo({
      "packages/api/src/app.ts": module,
      "packages/api/src/app.test.ts": suite,
      "packages/api/src/openapi.spec.ts": module,
      "packages/api/src/routes.spec.ts": suite,
      "packages/api/test/server.ts": module,
      "packages/shared/test/helpers/db.ts": module,
      "plugins/slicers/orca/test/fake.ts": module,
    });
    expect(sources(root).sort()).toEqual([
      "packages/api/src/app.ts",
      "packages/api/src/openapi.spec.ts",
      "packages/api/test/server.ts",
      "plugins/slicers/orca/test/fake.ts",
    ]);
  });
});
