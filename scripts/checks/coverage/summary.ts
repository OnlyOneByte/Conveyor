import { type Coverage, hitCount, type LineHits, zeroed } from "./lcov";

export const SWEEP_ENV = "CONVEYOR_COVERAGE_SWEEP";

export const SWEEP_REPORT_ENV = "CONVEYOR_COVERAGE_SWEEP_REPORT";

export const PACKAGES = ["api", "worker", "shared", "plugins", "web"] as const;

export type PackageName = (typeof PACKAGES)[number];

export const SWEEP_TIMEOUT_ENV = "CONVEYOR_COVERAGE_SWEEP_TIMEOUT_MS";

export const DEFAULT_SWEEP_TIMEOUT_MS = 30_000;

const CODE = /\.(ts|tsx|mts|cts|js|mjs)$/;

const DECLARATION = /\.d\.ts$/;

export const TEST_NAME = /\.(test|spec)\.(ts|tsx|mts|cts|js|mjs)$/;

export const TEST_HELPER_DIRS = [
  "packages/api/test/helpers/",
  "packages/shared/test/helpers/",
  "packages/worker/test/helpers/",
  "packages/web/test/helpers/",
];

const asPackage = (name: string | undefined): PackageName | null =>
  PACKAGES.find((known) => known === name) ?? null;

const rawPackageOf = (path: string): PackageName | null => {
  if (/^plugins\/[^/]+\/[^/]+\//.test(path)) return "plugins";
  const name = /^packages\/([^/]+)\//.exec(path)?.[1];
  return name === "plugins" ? null : asPackage(name);
};

export function packageOf(path: string): PackageName | null {
  if (!CODE.test(path) || DECLARATION.test(path)) return null;
  return rawPackageOf(path);
}

export const isTestFile = (path: string) =>
  TEST_HELPER_DIRS.some((dir) => path.startsWith(dir)) || TEST_NAME.test(path);

export const isSource = (path: string) => packageOf(path) !== null && !isTestFile(path);

export function sweepTimeoutMs(env: Record<string, string | undefined>): number | Error {
  const raw = env[SWEEP_TIMEOUT_ENV];
  if (raw === undefined || raw === "") return DEFAULT_SWEEP_TIMEOUT_MS;
  const value = Number(raw);
  if (Number.isInteger(value) && value > 0) return value;
  return new Error(`${SWEEP_TIMEOUT_ENV} must be a positive integer of milliseconds, got ${raw}`);
}

export interface MergeInput {
  sources: string[];
  measured: Coverage;
  sweep: Coverage;
  fallback: (path: string) => LineHits;
  typeLines: (path: string) => ReadonlySet<number>;
}

const withoutLines = (lines: LineHits, drop: ReadonlySet<number>): LineHits =>
  new Map([...lines].filter(([line]) => !drop.has(line)));

export interface Merged {
  coverage: Coverage;
  unloaded: string[];
  estimated: string[];
}

export function mergeCoverage({
  sources,
  measured,
  sweep,
  fallback,
  typeLines,
}: MergeInput): Merged {
  const coverage: Coverage = new Map();
  const unloaded: string[] = [];
  const estimated: string[] = [];
  for (const path of [...sources].sort()) {
    const mapped = sweep.get(path);
    if (!mapped) estimated.push(path);
    const loaded = measured.get(path);
    if (!loaded) unloaded.push(path);
    const lines = withoutLines(loaded ?? mapped ?? fallback(path), typeLines(path));
    coverage.set(path, loaded ? lines : zeroed(lines));
  }
  return { coverage, unloaded, estimated };
}

export interface SweepOutcome {
  completed: boolean;
  failed: string[];
  estimated: string[];
}

export function sweepErrors({ completed, failed, estimated }: SweepOutcome): string[] {
  return [
    ...(completed ? [] : ["coverage sweep did not finish; no line map for unloaded files"]),
    ...failed.map((path) => `coverage sweep: ${path} threw while importing`),
    ...estimated.map((path) => `coverage sweep: ${path} has no line map`),
  ];
}

const annotation = (message: string) =>
  `::error::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`;

export function printErrors(
  errors: string[],
  env: Record<string, string | undefined>,
  print: (text: string) => void,
): void {
  for (const error of errors) {
    print(error);
    if (env.GITHUB_ACTIONS === "true") print(annotation(error));
  }
}

export interface SweepRun {
  completed: boolean;
  failed: string[];
  output: string;
}

export function printSweepLog(
  { completed, failed, output }: SweepRun,
  print: (text: string) => void,
): void {
  if (!completed || failed.length > 0) print(output);
}

export interface LineTotals {
  found: number;
  hit: number;
}

export type Summary = Record<PackageName, LineTotals>;

const byPackage = <T>(value: (name: PackageName) => T): Record<PackageName, T> => ({
  api: value("api"),
  worker: value("worker"),
  shared: value("shared"),
  plugins: value("plugins"),
  web: value("web"),
});

export function summarize(coverage: Coverage): Summary {
  const summary = byPackage(() => ({ found: 0, hit: 0 }));
  for (const [path, lines] of coverage) {
    const name = packageOf(path);
    if (name === null) continue;
    summary[name].found += lines.size;
    summary[name].hit += hitCount(lines);
  }
  return summary;
}

export const round2 = (value: number) => Math.round(value * 100) / 100;

export const percent = ({ found, hit }: LineTotals) =>
  found === 0 ? 100 : round2((hit * 100) / found);

export function overall(summary: Summary): LineTotals {
  return Object.values(summary).reduce(
    (sum, totals) => ({ found: sum.found + totals.found, hit: sum.hit + totals.hit }),
    { found: 0, hit: 0 },
  );
}

export const percents = (summary: Summary): Record<PackageName, number> =>
  byPackage((name) => percent(summary[name]));

export function nonBlankLines(source: string): LineHits {
  const lines: LineHits = new Map();
  for (const [index, text] of source.split("\n").entries()) {
    if (text.trim() !== "") lines.set(index + 1, 0);
  }
  return lines;
}
