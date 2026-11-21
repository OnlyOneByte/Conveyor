import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseLcov, serializeLcov } from "./lcov";
import {
  BASELINE_PATH,
  checkRatchet,
  parseBaseline,
  raisedBaseline,
  serializeBaseline,
  updateRefusal,
} from "./ratchet";
import { ROOT, readBase, readOrNull, runSweep, sources } from "./runner";
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
