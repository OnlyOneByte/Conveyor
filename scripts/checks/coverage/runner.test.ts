import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { baselinePath, CHECKER_PATH } from "./ratchet";
import { ROOT, readBase, readCommitted, runSweep, sources } from "./runner";
import { isSource, mergeCoverage, SWEEP_TIMEOUT_ENV, summarize } from "./summary";

const scratch = mkdtempSync(join(tmpdir(), "conveyor-runner-test-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const fixture = (name: string, source: string) => {
  const path = join(scratch, name);
  writeFileSync(path, source);
  return path;
};

const SLOW = 60_000;
const PROBE_PREFIX = join("packages", "shared", "test", "sweep-probe-");

const withEnv = <T>(name: string, value: string, run: () => T): T => {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
};

const withSweepTimeout = <T>(value: string, run: () => T): T =>
  withEnv(SWEEP_TIMEOUT_ENV, value, run);

describe("runSweep", () => {
  test(
    "runs the sweep without GITHUB_ACTIONS, so its expected failures post no CI annotations",
    () => {
      const seen = join(scratch, "seen-github-actions.txt");
      const probe = fixture(
        "reads-env.ts",
        `require("node:fs").writeFileSync(${JSON.stringify(seen)}, String(process.env.GITHUB_ACTIONS));\n`,
      );
      const sweep = withEnv("GITHUB_ACTIONS", "true", () => runSweep([probe]));
      expect(sweep.completed).toBe(true);
      expect(readFileSync(seen, "utf8")).toBe("undefined");
    },
    SLOW,
  );

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
      const started = performance.now();
      expect(withSweepTimeout("500", () => runSweep([hangs])).completed).toBe(false);
      expect(performance.now() - started).toBeLessThan(SLOW / 2);
    },
    SLOW,
  );

  test(
    "an invalid timeout fails the sweep instead of running it unbounded",
    () => {
      const ok = fixture("valid.ts", "export const two = () => 2;\n");
      expect(withSweepTimeout("soon", () => runSweep([ok])).completed).toBe(false);
    },
    SLOW,
  );

  test(
    "a source module and a test-folder module are mapped by the sweep and counted",
    () => {
      const dir = mkdtempSync(join(ROOT, PROBE_PREFIX));
      try {
        const module = "export const double = (n: number) => n * 2;\n";
        writeFileSync(join(dir, "double.ts"), module);
        writeFileSync(join(dir, "fake.ts"), module);
        const paths = ["double.ts", "fake.ts"].map((name) => relative(ROOT, join(dir, name)));
        for (const path of paths) {
          expect(isSource(path)).toBe(true);
        }
        const sweep = runSweep(paths);
        expect(sweep.completed).toBe(true);
        const merged = mergeCoverage({
          sources: paths,
          measured: new Map(),
          sweep: sweep.coverage,
          fallback: () => new Map(),
          typeLines: () => new Set(),
        });
        expect(merged.estimated).toEqual([]);
        expect(summarize(merged.coverage).shared).toEqual({ found: 2, hit: 0 });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    SLOW,
  );
});

describe("bunfig.toml", () => {
  test("keeps bun test out of a sweep probe left behind by a killed run", () => {
    const config = Bun.TOML.parse(readFileSync(join(ROOT, "bunfig.toml"), "utf8")) as {
      test?: { pathIgnorePatterns?: string[] };
    };
    const ignored = config.test?.pathIgnorePatterns ?? [];
    const leftover = `${PROBE_PREFIX}AbC123/double.spec.ts`;
    expect(ignored.some((pattern) => new Bun.Glob(pattern).match(leftover))).toBe(true);
  });
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

const none = { api: null, worker: null, shared: null, plugins: null };

describe("readBase", () => {
  test("detects a base that has the checker but no baseline", () => {
    const root = repo({ [CHECKER_PATH]: "export {};\n" });
    expect(readBase("HEAD", root)).toEqual({ baseline: none, hasChecker: true });
  });

  test("detects a base that predates the checker", () => {
    const root = repo({ "README.md": "x\n" });
    expect(readBase("HEAD", root)).toEqual({ baseline: none, hasChecker: false });
  });

  test("reads one file per package from the base", () => {
    const root = repo({
      [CHECKER_PATH]: "export {};\n",
      [baselinePath("api")]: "40\n",
      [baselinePath("shared")]: "80\n",
    });
    expect(readBase("HEAD", root)).toEqual({
      baseline: { ...none, api: "40\n", shared: "80\n" },
      hasChecker: true,
    });
  });

  test("ignores a legacy single-file baseline left in the base", () => {
    const root = repo({
      [CHECKER_PATH]: "export {};\n",
      "scripts/checks/coverage/baseline.json": '{"lines":{"api":35.51,"worker":79}}\n',
    });
    expect(readBase("HEAD", root)).toEqual({ baseline: none, hasChecker: true });
  });

  test("an unresolvable base ref is an error", () => {
    const root = repo({ "README.md": "x\n" });
    expect(readBase("no-such-ref", root)).toBeInstanceOf(Error);
  });
});

describe("readCommitted", () => {
  test("reads each package file from the working tree", () => {
    const root = repo({ [baselinePath("worker")]: "79.01\n" });
    expect(readCommitted(root)).toEqual({ ...none, worker: "79.01\n" });
  });
});

describe("sources", () => {
  test("lists source and test-folder modules, not test-named files or declared helpers", () => {
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
      "packages/api/test/server.ts",
      "plugins/slicers/orca/test/fake.ts",
    ]);
  });
});
