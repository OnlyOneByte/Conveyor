import { type Coverage, exactHits, hitCount, type LineHits, zeroed } from "./lcov";

export const SWEEP_ENV = "CONVEYOR_COVERAGE_SWEEP";

export const SWEEP_REPORT_ENV = "CONVEYOR_COVERAGE_SWEEP_REPORT";

export const PACKAGES = ["api", "worker", "shared", "plugins"] as const;

export type PackageName = (typeof PACKAGES)[number];

const PACKAGE_SOURCE = /^packages\/([^/]+)\/src\/.+\.(ts|tsx|mts|cts|js|mjs)$/;

const PLUGIN_SOURCE = /^plugins\/[^/]+\/[^/]+\/src\/.+\.(ts|tsx|mts|cts|js|mjs)$/;

const TEST = /\.(test|spec)\.[^.]+$/;

const asPackage = (name: string | undefined): PackageName | null =>
  PACKAGES.find((known) => known === name) ?? null;

const rawPackageOf = (path: string): PackageName | null => {
  if (PLUGIN_SOURCE.test(path)) return "plugins";
  const name = PACKAGE_SOURCE.exec(path)?.[1];
  return name === "plugins" ? null : asPackage(name);
};

export function packageOf(path: string): PackageName | null {
  if (TEST.test(path) || path.endsWith(".d.ts")) return null;
  return rawPackageOf(path);
}

export const isSource = (path: string) => packageOf(path) !== null;

export interface MergeInput {
  sources: string[];
  measured: Coverage;
  sweep: Coverage;
  fallback: (path: string) => LineHits;
}

export interface Merged {
  coverage: Coverage;
  unloaded: string[];
  estimated: string[];
}

export function mergeCoverage({ sources, measured, sweep, fallback }: MergeInput): Merged {
  const coverage: Coverage = new Map();
  const unloaded: string[] = [];
  const estimated: string[] = [];
  for (const path of [...sources].sort()) {
    const mapped = sweep.get(path);
    if (!mapped) estimated.push(path);
    const lines = mapped ?? fallback(path);
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
