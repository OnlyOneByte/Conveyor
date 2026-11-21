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
  checkRatchet,
  parseBaseline,
  raisedBaseline,
  serializeBaseline,
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
  summarize,
} from "./summary";

const ROOT = join(import.meta.dir, "..", "..", "..");

const SWEEP_PATH = "./scripts/checks/coverage/sweep.ts";

const git = (args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd: ROOT, stderr: "pipe" });
  return result.exitCode === 0 ? result.stdout.toString() : null;
};

const readOrNull = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);

const sources = () =>
  (git(["ls-files", "-z", "--", "packages"]) ?? "").split("\0").filter(isSource);

function runSweep(files: string[]): Coverage {
  if (files.length === 0) return new Map();
  const dir = mkdtempSync(join(tmpdir(), "conveyor-sweep-"));
  try {
    const args = ["test", SWEEP_PATH, "--coverage", "--coverage-reporter=lcov"];
    const result = Bun.spawnSync(["bun", ...args, `--coverage-dir=${dir}`], {
      cwd: ROOT,
      env: { ...process.env, [SWEEP_ENV]: files.join("\n") },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) console.error(result.stderr.toString());
    return parseLcov(readOrNull(join(dir, "lcov.info")) ?? "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const table = (summary: Summary) => {
  const total = overall(summary);
  const rows = PACKAGES.map(
    (name) =>
      `| ${name} | ${summary[name].hit} / ${summary[name].found} | ${percent(summary[name]).toFixed(2)}% |`,
  );
  return [
    "| package | lines hit / found | line % |",
    "| --- | --- | --- |",
    ...rows,
    `| **all** | ${total.hit} / ${total.found} | ${percent(total).toFixed(2)}% |`,
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
  const merged = mergeCoverage({ sources: all, measured, sweep, fallback });
  writeFileSync(join(ROOT, outPath), serializeLcov(merged.coverage));
  for (const path of merged.estimated) {
    console.error(`warning: ${path} could not be loaded; counted every non-blank line as missed`);
  }
  const summary = summarize(merged.coverage);
  const report = `### Line coverage (all source files in ${PACKAGES.join(", ")})\n\n${table(summary)}\n\n${merged.unloaded.length} of ${all.length} source files are loaded by no test and count as 0%.\n`;
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  return summary;
}

function update(summary: Summary): number {
  if (process.env.CI) {
    console.error("--update is local only; commit the regenerated baseline instead");
    return 1;
  }
  const path = join(ROOT, BASELINE_PATH);
  const committed = parseBaseline(readOrNull(path) ?? "");
  writeFileSync(path, serializeBaseline(raisedBaseline(percents(summary), committed)));
  console.log(`wrote ${BASELINE_PATH}`);
  return 0;
}

function baseBaseline(ref: string): string | null | Error {
  if (git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) === null) {
    return new Error(`base ref ${ref} does not resolve; fetch it first`);
  }
  return git(["show", `${ref}:${BASELINE_PATH}`]);
}

function check(summary: Summary, ref: string): number {
  const base = baseBaseline(ref);
  if (base instanceof Error) {
    console.error(base.message);
    return 1;
  }
  const { errors, notices } = checkRatchet({
    current: percents(summary),
    committed: readOrNull(join(ROOT, BASELINE_PATH)),
    base,
  });
  for (const notice of notices) console.log(notice);
  for (const error of errors) console.error(error);
  if (base === null) console.log(`base ${ref} has no ${BASELINE_PATH}; using the committed one`);
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
