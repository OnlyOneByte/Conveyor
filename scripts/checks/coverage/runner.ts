import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Resolve, runtimeResolver } from "./imports";
import { type Coverage, parseLcov } from "./lcov";
import {
  type BaselineTexts,
  baselinePath,
  CHECKER_PATH,
  PACKAGES_PATH,
  parsePackages,
} from "./ratchet";
import type { FileChange } from "./reclassified";
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

const withoutCiAnnotations = (env: Record<string, string | undefined>) => {
  const { GITHUB_ACTIONS: _annotations, ...rest } = env;
  return rest;
};

const sweepEnv = (dir: string, files: string[]) => ({
  ...withoutCiAnnotations(process.env),
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
  packages: string[] | null;
}

export function readBase(ref: string, root = ROOT): Base | Error {
  if (git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) === null) {
    return new Error(`base ref ${ref} does not resolve; fetch it first`);
  }
  return {
    baseline: baselineTexts((path) => git(root, ["show", `${ref}:${path}`])),
    hasChecker: git(root, ["cat-file", "-e", `${ref}:${CHECKER_PATH}`]) !== null,
    packages: parsePackages(git(root, ["show", `${ref}:${PACKAGES_PATH}`])),
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

const diffPath = (field: string) => (field === "/dev/null" ? null : field.replace(/^[ab]\//, ""));

function samePathPair(rest: string): string | null {
  const path = rest.slice(2, (rest.length - 1) / 2);
  return rest === `a/${path} b/${path}` ? path : null;
}

function readHeader(change: FileChange, line: string) {
  if (line.startsWith("rename from ")) change.from = line.slice(12);
  else if (line.startsWith("rename to ")) {
    change.to = line.slice(10);
    change.renamed = true;
  } else if (line.startsWith("--- ")) change.from = diffPath(line.slice(4));
  else if (line.startsWith("+++ ")) change.to = diffPath(line.slice(4));
  else if (line.startsWith("new file mode ")) change.from = null;
  else if (line.startsWith("deleted file mode ")) change.to = null;
  else if (!/^(index |similarity index )/.test(line)) change.opaque = true;
}

function readBody(change: FileChange, line: string) {
  if (line.startsWith("-")) change.removed.push(line.slice(1));
  else if (line.startsWith("+")) change.added.push(line.slice(1));
}

const startChange = (line: string): FileChange => {
  const path = samePathPair(line.slice(11)) ?? `"${line.slice(11)}`;
  return { from: path, to: path, renamed: false, opaque: false, removed: [], added: [] };
};

export function parseDiff(text: string): FileChange[] {
  const changes: FileChange[] = [];
  let hunk = false;
  for (const line of text.split("\n")) {
    const change = changes.at(-1);
    if (line.startsWith("diff --git ")) {
      changes.push(startChange(line));
      hunk = false;
    } else if (change === undefined || line === "") continue;
    else if (line.startsWith("@@")) hunk = true;
    else if (hunk) readBody(change, line);
    else readHeader(change, line);
  }
  return changes;
}

export function changesSince(ref: string, root = ROOT): FileChange[] | null {
  const args = [
    "-c",
    "core.quotePath=false",
    "diff",
    "-U0",
    "-M90%",
    "--no-color",
    "--no-ext-diff",
  ];
  const text = git(root, [...args, "--no-textconv", ref, "HEAD"]);
  return text === null ? null : parseDiff(text);
}

export interface Tree {
  resolve: Resolve;
  dispose: () => void;
}

export function treeAt(ref: string, root = ROOT): Tree {
  let dir: string | null = null;
  let resolve: Resolve | null = null;
  const build = (): Resolve => {
    dir = mkdtempSync(join(tmpdir(), "conveyor-base-tree-"));
    const tree = join(dir, "tree");
    const archive = join(dir, "tree.tar");
    mkdirSync(tree);
    const packed = git(root, ["archive", "--format=tar", `--output=${archive}`, ref]) !== null;
    const unpacked = packed && Bun.spawnSync(["tar", "-xf", archive, "-C", tree]).exitCode === 0;
    return unpacked ? runtimeResolver(tree) : () => null;
  };
  return {
    resolve: (specifier, from) => {
      resolve ??= build();
      return resolve(specifier, from);
    },
    dispose: () => {
      if (dir !== null) rmSync(dir, { recursive: true, force: true });
    },
  };
}
