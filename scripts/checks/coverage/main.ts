import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runtimeResolver, sourceImportErrors, suiteErrors, symlinkErrors } from "./imports";
import { parseLcov, serializeLcov } from "./lcov";
import {
  BASELINE_DIR,
  baselineWrites,
  checkRatchet,
  parseBaseline,
  updateRefusal,
} from "./ratchet";
import {
  ROOT,
  readBase,
  readCommitted,
  readOrNull,
  runSweep,
  sources,
  stagedEntries,
  testNamedFiles,
} from "./runner";
import {
  mergeCoverage,
  nonBlankLines,
  overall,
  PACKAGES,
  percent,
  percents,
  type Summary,
  summarize,
  sweepErrors,
} from "./summary";
import { typeOnlyLines } from "./type-lines";

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
  const typeLines = (path: string) => typeOnlyLines(path, readOrNull(join(ROOT, path)) ?? "");
  const merged = mergeCoverage({
    sources: all,
    measured,
    sweep: sweep.coverage,
    fallback,
    typeLines,
  });
  writeFileSync(join(ROOT, outPath), serializeLcov(merged.coverage));
  const summary = summarize(merged.coverage);
  const report = `### Line coverage (all source files in ${PACKAGES.join(", ")})\n\n${table(summary)}\n\n${merged.unloaded.length} of ${all.length} source files are loaded by no test and count as 0%.\n`;
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  const errors = [
    ...sweepErrors({ ...sweep, estimated: merged.estimated }),
    ...sourceImportErrors(all, (path) => readOrNull(join(ROOT, path)) ?? "", runtimeResolver(ROOT)),
    ...symlinkErrors(stagedEntries()),
    ...suiteErrors(testNamedFiles(), (path) => readOrNull(join(ROOT, path)) ?? ""),
  ];
  for (const error of errors) console.error(error);
  return errors.length === 0 ? summary : null;
}

function update(summary: Summary): number {
  const refusal = updateRefusal(process.env);
  if (refusal !== null) {
    console.error(refusal);
    return 1;
  }
  mkdirSync(join(ROOT, BASELINE_DIR), { recursive: true });
  for (const [path, text] of baselineWrites(percents(summary), readCommitted())) {
    writeFileSync(join(ROOT, path), text);
    console.log(`wrote ${path}`);
  }
  return 0;
}

function check(summary: Summary, ref: string): number {
  const base = readBase(ref);
  if (base instanceof Error) {
    console.error(base.message);
    return 1;
  }
  const { errors } = checkRatchet({
    current: percents(summary),
    committed: readCommitted(),
    base: base.baseline,
    baseHasChecker: base.hasChecker,
  });
  for (const error of errors) console.error(error);
  if (parseBaseline(base.baseline) === null && !base.hasChecker) {
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
