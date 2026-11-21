import type { FileTally } from "./tally";

export interface Baseline {
  files: Record<string, FileTally>;
}

export type Metric = keyof FileTally;

const METRICS: Metric[] = ["comments", "suppressions"];

const ZERO: FileTally = { comments: 0, suppressions: 0 };

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFileTally = (value: unknown): value is FileTally =>
  isRecord(value) && METRICS.every((metric) => isCount(value[metric]));

export const isBaseline = (value: unknown): value is Baseline =>
  isRecord(value) && isRecord(value.files) && Object.values(value.files).every(isFileTally);

export function parseBaseline(text: string): Baseline | null {
  try {
    const value: unknown = JSON.parse(text);
    return isBaseline(value) ? value : null;
  } catch {
    return null;
  }
}

export const isNonzero = (tally: FileTally) => METRICS.some((metric) => tally[metric] > 0);

export function serializeBaseline(baseline: Baseline): string {
  const sorted = Object.fromEntries(
    Object.entries(baseline.files)
      .filter(([, tally]) => isNonzero(tally))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return `${JSON.stringify({ files: sorted }, null, 2)}\n`;
}

export function totals(baseline: Baseline): FileTally {
  return Object.values(baseline.files).reduce(
    (sum, tally) => ({
      comments: sum.comments + tally.comments,
      suppressions: sum.suppressions + tally.suppressions,
    }),
    ZERO,
  );
}

export interface Excess {
  file: string;
  metric: Metric;
  actual: number;
  allowed: number;
}

const sameTally = (a: FileTally, b: FileTally) =>
  METRICS.every((metric) => a[metric] === b[metric]);

export interface Comparison {
  actual: Baseline;
  allowed: Baseline;
  present: ReadonlySet<string>;
}

export function followRenames({ actual, allowed, present }: Comparison): Baseline {
  const files = { ...allowed.files };
  const vanished = Object.entries(allowed.files).filter(
    ([path, tally]) => isNonzero(tally) && !present.has(path),
  );
  for (const [path, tally] of Object.entries(actual.files)) {
    if (path in allowed.files || !isNonzero(tally)) continue;
    const match = vanished.findIndex(([, old]) => sameTally(old, tally));
    if (match === -1) continue;
    files[path] = tally;
    vanished.splice(match, 1);
  }
  return { files };
}

export function excesses(comparison: Comparison): Excess[] {
  const allowance = followRenames(comparison);
  return Object.entries(comparison.actual.files).flatMap(([file, tally]) =>
    METRICS.map((metric) => ({
      file,
      metric,
      actual: tally[metric],
      allowed: (allowance.files[file] ?? ZERO)[metric],
    })).filter((entry) => entry.actual > entry.allowed),
  );
}

export const sameBaseline = (a: Baseline, b: Baseline): boolean =>
  serializeBaseline(a) === serializeBaseline(b);
