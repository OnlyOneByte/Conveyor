import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runtimeResolver, sourceImportErrors, suiteErrors, symlinkErrors } from "./imports";
import { parseLcov, serializeLcov } from "./lcov";
import {
  BASELINE_DIR,
  type BaselineTexts,
  baselineWrites,
  checkRatchet,
  newPackages,
  type Percents,
  parseBaseline,
  type RatchetInput,
  riseIsWarning,
  updateRefusal,
} from "./ratchet";
import { parseReclassifications, RECLASSIFIED_PATH, reclassificationFloors } from "./reclassified";
import {
  type Base,
  changesSince,
  linesAt,
  ROOT,
  readAt,
  readBase,
  readCommitted,
  readOrNull,
  renamedSince,
  runSweep,
  sources,
  stagedEntries,
  testNamedFiles,
  treeAt,
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

const linesOf = (texts: BaselineTexts): Percents => {
  const parsed = parseBaseline(texts);
  return parsed !== null && typeof parsed !== "string" ? parsed.lines : {};
};

function reclassified(summary: Summary, ref: string, base: BaselineTexts) {
  const head = parseReclassifications(readOrNull(join(ROOT, RECLASSIFIED_PATH)));
  const old = parseReclassifications(readAt(ref, RECLASSIFIED_PATH));
  if (typeof head === "string") return { floors: {}, errors: [head], notes: [] };
  if (typeof old === "string") return { floors: {}, errors: [`base ${old}`], notes: [] };
  const tree = treeAt(ref);
  try {
    return reclassificationFloors(head, old, {
      renamed: renamedSince(ref),
      changes: changesSince(ref),
      resolveAtBase: tree.resolve,
      resolveAtHead: runtimeResolver(ROOT),
      baseLines: linesAt(ref),
      current: summary,
      base: linesOf(base),
      committed: linesOf(readCommitted()),
    });
  } finally {
    tree.dispose();
  }
}

export interface CheckContext {
  summary: Summary;
  committed: BaselineTexts;
  base: Base;
  floors: Percents;
  env: Record<string, string | undefined>;
}

export function ratchetInput({
  summary,
  committed,
  base,
  floors,
  env,
}: CheckContext): RatchetInput {
  return {
    current: percents(summary),
    committed,
    base: base.baseline,
    baseHasChecker: base.hasChecker,
    basePackages: base.packages,
    reclassifiedFloors: floors,
    riseIsWarning: riseIsWarning(env),
  };
}

function check(summary: Summary, ref: string): number {
  const base = readBase(ref);
  if (base instanceof Error) {
    console.error(base.message);
    return 1;
  }
  const moves = reclassified(summary, ref, base.baseline);
  const { errors, warnings } = checkRatchet(
    ratchetInput({
      summary,
      committed: readCommitted(),
      base,
      floors: moves.floors,
      env: process.env,
    }),
  );
  for (const error of [...moves.errors, ...errors]) console.error(error);
  for (const warning of warnings) console.log(`::warning::${warning}`);
  for (const note of moves.notes) console.log(note);
  for (const name of newPackages(base.packages)) {
    console.log(
      `${name}: new in this change (base ${ref} doesn't measure it); its floor starts at the committed baseline`,
    );
  }
  if (parseBaseline(base.baseline) === null && !base.hasChecker) {
    console.log(
      `base ${ref} predates the coverage checker; bootstrapping from the committed baseline`,
    );
  }
  return errors.length === 0 && moves.errors.length === 0 ? 0 : 1;
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
