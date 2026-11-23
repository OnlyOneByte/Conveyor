import { type Coverage, exactHits, hitCount, type LineHits, zeroed } from "./lcov";

export const SWEEP_ENV = "CONVEYOR_COVERAGE_SWEEP";

export const SWEEP_REPORT_ENV = "CONVEYOR_COVERAGE_SWEEP_REPORT";

export const PACKAGES = ["api", "worker", "shared", "plugins"] as const;

export type PackageName = (typeof PACKAGES)[number];

export const SWEEP_TIMEOUT_ENV = "CONVEYOR_COVERAGE_SWEEP_TIMEOUT_MS";

export const DEFAULT_SWEEP_TIMEOUT_MS = 30_000;

const CODE = /\.(ts|tsx|mts|cts|js|mjs)$/;

const DECLARATION = /\.d\.ts$/;

const TEST_NAME = /\.(test|spec)\.(ts|tsx|mts|cts|js|mjs)$/;

const TEST_IMPORT = /\b(from|import|require)\s*\(?\s*["']bun:test["']/;

export const TEST_HELPER_DIRS = ["packages/shared/test/helpers/", "packages/worker/test/helpers/"];

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

export const isTestFile = (path: string, text: string) =>
  TEST_HELPER_DIRS.some((dir) => path.startsWith(dir)) ||
  (TEST_NAME.test(path) && TEST_IMPORT.test(text));

export const isSource = (path: string, read: () => string) =>
  packageOf(path) !== null && !isTestFile(path, read());

const HELPER_IMPORT = /\b(?:from|import|require)\s*\(?\s*["']([^"']*\btest\/helpers\/[^"']*)["']/g;

export function helperImportErrors(sources: string[], read: (path: string) => string): string[] {
  return sources.flatMap((path) =>
    [...read(path).matchAll(HELPER_IMPORT)].map(
      (match) => `${path} imports the test helper ${match[1]}; only tests may`,
    ),
  );
}

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
    const lines = withoutLines(mapped ?? fallback(path), typeLines(path));
    const loaded = measured.get(path);
    if (!loaded) unloaded.push(path);
    coverage.set(path, loaded ? exactHits(lines, loaded) : zeroed(lines));
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
