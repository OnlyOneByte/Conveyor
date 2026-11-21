import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type Coverage, parseLcov, serializeLcov } from "./lcov";
import {
  BASELINE_PATH,
  CHECKER_PATH,
  checkRatchet,
  parseBaseline,
  raisedBaseline,
  serializeBaseline,
  updateRefusal,
} from "./ratchet";
import {
  isSource,
  mergeCoverage,
  nonBlankLines,
  overall,
  PACKAGES,
  percent,
  percents,
  type Summary,
  SWEEP_ENV,
  SWEEP_REPORT_ENV,
  summarize,
  sweepErrors,
} from "./summary";

const ROOT = join(import.meta.dir, "..", "..", "..");

const SWEEP_PATH = "./scripts/checks/coverage/sweep.ts";

const git = (args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd: ROOT, stderr: "pipe" });
  return result.exitCode === 0 ? result.stdout.toString() : null;
};

const readOrNull = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);

const sources = () =>
  (git(["ls-files", "-z", "--", "packages", "plugins"]) ?? "").split("\0").filter(isSource);

interface Sweep {
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

function runSweep(files: string[]): Sweep {
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

const table = (summary: Summary) => {
  const total = overall(summary);
  const rows = PACKAGES.map(
    (name) =>
      `| ${name} | ${summary[name].hit} | ${summary[name].found} | ${percent(summary[name]).toFixed(2)}% |`,
  );
  return [
    "| package | lines covered | lines found | line % |",
    "| --- | --- | --- | --- |",
    ...rows,
    `| **all** | ${total.hit} | ${total.found} | ${percent(total).toFixed(2)}% |`,
  ].join("\n");
};

function measure(lcovPath: string, outPath: string): Summary | null {
  const lcov = readOrNull(join(ROOT, lcovPath));
  if (lcov === null) {
    console.error(`${lcovPath} not found; run \`bun test --coverage --coverage-reporter=lcov\``);
    return null;
  }
  const measured = parseLcov(lcov);
  const all = sources();
  const sweep = runSweep(all);
  const fallback = (path: string) => nonBlankLines(readOrNull(join(ROOT, path)) ?? "");
  const merged = mergeCoverage({ sources: all, measured, sweep: sweep.coverage, fallback });
  writeFileSync(join(ROOT, outPath), serializeLcov(merged.coverage));
  const summary = summarize(merged.coverage);
  const report = `### Line coverage (all source files in ${PACKAGES.join(", ")})\n\n${table(summary)}\n\n${merged.unloaded.length} of ${all.length} source files are loaded by no test and count as 0%.\n`;
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  const errors = sweepErrors({ ...sweep, estimated: merged.estimated });
  for (const error of errors) console.error(error);
  return errors.length === 0 ? summary : null;
}

function update(summary: Summary): number {
  const refusal = updateRefusal(process.env);
  if (refusal !== null) {
    console.error(refusal);
    return 1;
  }
  const path = join(ROOT, BASELINE_PATH);
  const committed = parseBaseline(readOrNull(path) ?? "");
  writeFileSync(path, serializeBaseline(raisedBaseline(percents(summary), committed)));
  console.log(`wrote ${BASELINE_PATH}`);
  return 0;
}

interface Base {
  baseline: string | null;
  hasChecker: boolean;
}

function readBase(ref: string): Base | Error {
  if (git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) === null) {
    return new Error(`base ref ${ref} does not resolve; fetch it first`);
  }
  return {
    baseline: git(["show", `${ref}:${BASELINE_PATH}`]),
    hasChecker: git(["cat-file", "-e", `${ref}:${CHECKER_PATH}`]) !== null,
  };
}

function check(summary: Summary, ref: string): number {
  const base = readBase(ref);
  if (base instanceof Error) {
    console.error(base.message);
    return 1;
  }
  const { errors } = checkRatchet({
    current: percents(summary),
    committed: readOrNull(join(ROOT, BASELINE_PATH)),
    base: base.baseline,
    baseHasChecker: base.hasChecker,
  });
  for (const error of errors) console.error(error);
  if (base.baseline === null && !base.hasChecker) {
    console.log(
      `base ${ref} predates the coverage checker; bootstrapping from the committed baseline`,
    );
  }
  return errors.length === 0 ? 0 : 1;
}

function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      update: { type: "boolean", default: false },
      base: { type: "string", default: "origin/main" },
      lcov: { type: "string", default: "coverage/lcov.info" },
      out: { type: "string", default: "coverage/merged.lcov" },
    },
  });
  const summary = measure(values.lcov, values.out);
  if (summary === null) return 1;
  return values.update ? update(summary) : check(summary, values.base);
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
