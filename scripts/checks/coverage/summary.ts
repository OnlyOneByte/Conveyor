import { type Coverage, hitCount, type LineHits, zeroed } from "./lcov";

export const SWEEP_ENV = "CONVEYOR_COVERAGE_SWEEP";

export const PACKAGES = ["api", "worker", "shared"] as const;

export type PackageName = (typeof PACKAGES)[number];

const SOURCE = /^packages\/([^/]+)\/src\/.+\.(ts|tsx|mts|cts|js|mjs)$/;

const TEST = /\.(test|spec)\.[^.]+$/;

const isPackage = (name: string): name is PackageName =>
  (PACKAGES as readonly string[]).includes(name);

export function packageOf(path: string): PackageName | null {
  const name = SOURCE.exec(path)?.[1];
  if (name === undefined || !isPackage(name)) return null;
  if (TEST.test(path) || path.endsWith(".d.ts")) return null;
  return name;
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
    const loaded = measured.get(path);
    if (loaded) {
      coverage.set(path, loaded);
      continue;
    }
    unloaded.push(path);
    const mapped = sweep.get(path);
    if (!mapped) estimated.push(path);
    coverage.set(path, zeroed(mapped ?? fallback(path)));
  }
  return { coverage, unloaded, estimated };
}

export interface LineTotals {
  found: number;
  hit: number;
}

export type Summary = Record<PackageName, LineTotals>;

export function summarize(coverage: Coverage): Summary {
  const summary = Object.fromEntries(
    PACKAGES.map((name) => [name, { found: 0, hit: 0 }]),
  ) as Summary;
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
  Object.fromEntries(PACKAGES.map((name) => [name, percent(summary[name])])) as Record<
    PackageName,
    number
  >;

export const nonBlankLines = (source: string): LineHits =>
  new Map(
    source
      .split("\n")
      .map((text, index) => [index + 1, text.trim()] as const)
      .filter(([, text]) => text !== "")
      .map(([line]) => [line, 0]),
  );
