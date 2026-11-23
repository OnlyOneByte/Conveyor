import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Coverage, parseLcov } from "./lcov";
import { type BaselineTexts, baselinePath, CHECKER_PATH } from "./ratchet";
import {
  isSource,
  nonBlankLines,
  PACKAGES,
  SWEEP_ENV,
  SWEEP_REPORT_ENV,
  TEST_NAME,
} from "./summary";
import { typeOnlyLines } from "./type-lines";

export const ROOT = join(import.meta.dir, "..", "..", "..");

const SWEEP_PATH = "./scripts/checks/coverage/sweep.ts";

const git = (root: string, args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stderr: "pipe" });
  return result.exitCode === 0 ? result.stdout.toString() : null;
};

export const readOrNull = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);

export const sources = (root = ROOT) =>
  (git(root, ["ls-files", "-z", "--", "packages", "plugins"]) ?? "")
    .split("\0")
    .filter((path) => isSource(path));

export const testNamedFiles = (root = ROOT) =>
  (git(root, ["ls-files", "-z", "--", "packages", "plugins"]) ?? "")
    .split("\0")
    .filter((path) => TEST_NAME.test(path));

export const stagedEntries = (root = ROOT) =>
  git(root, ["ls-files", "-s", "-z", "--", "packages", "plugins"]) ?? "";

export interface Sweep {
  coverage: Coverage;
  completed: boolean;
  failed: string[];
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function readFailures(text: string | null): string[] | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || !("failed" in value)) return null;
    return isStringArray(value.failed) ? value.failed : null;
  } catch {
    return null;
  }
}

const sweepEnv = (dir: string, files: string[]) => ({
  ...process.env,
  CONVEYOR_AUTH: "disabled",
  DB_PATH: join(dir, "sweep.db"),
  DATA_DIR: join(dir, "data"),
  [SWEEP_ENV]: files.join("\n"),
  [SWEEP_REPORT_ENV]: join(dir, "report.json"),
});

export function runSweep(files: string[]): Sweep {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-sweep-"));
  try {
    const args = ["test", SWEEP_PATH, "--coverage", "--coverage-reporter=lcov"];
    const result = Bun.spawnSync(["bun", ...args, `--coverage-dir=${dir}`], {
      cwd: ROOT,
      env: sweepEnv(dir, files),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) console.error(result.stderr.toString());
    const failures = readFailures(readOrNull(join(dir, "report.json")));
    return {
      coverage: parseLcov(readOrNull(join(dir, "lcov.info")) ?? ""),
      completed: result.exitCode === 0 && failures !== null,
      failed: failures ?? [],
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const baselineTexts = (read: (path: string) => string | null): BaselineTexts =>
  Object.fromEntries(PACKAGES.map((name) => [name, read(baselinePath(name))]));

export const readCommitted = (root = ROOT) => baselineTexts((path) => readOrNull(join(root, path)));

export interface Base {
  baseline: BaselineTexts;
  hasChecker: boolean;
}

export function readBase(ref: string, root = ROOT): Base | Error {
  if (git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) === null) {
    return new Error(`base ref ${ref} does not resolve; fetch it first`);
  }
  return {
    baseline: baselineTexts((path) => git(root, ["show", `${ref}:${path}`])),
    hasChecker: git(root, ["cat-file", "-e", `${ref}:${CHECKER_PATH}`]) !== null,
  };
}

export const readAt = (ref: string, path: string, root = ROOT) =>
  git(root, ["show", `${ref}:${path}`]);

export function renamedSince(ref: string, root = ROOT): (from: string, to: string) => boolean {
  const moves = new Set(
    (git(root, ["diff", "--name-status", "-M90%", ref, "HEAD"]) ?? "")
      .split("\n")
      .map((line) => line.split("\t"))
      .filter((fields) => fields[0]?.startsWith("R") && fields.length === 3)
      .map((fields) => `${fields[1]}\0${fields[2]}`),
  );
  return (from, to) => moves.has(`${from}\0${to}`);
}

export function linesAt(ref: string, root = ROOT): (path: string) => number | null {
  return (path) => {
    const text = readAt(ref, path, root);
    if (text === null) return null;
    const types = typeOnlyLines(path, text);
    return [...nonBlankLines(text).keys()].filter((line) => !types.has(line)).length;
  };
}
