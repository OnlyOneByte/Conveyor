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

export function serializeBaseline(baseline: Baseline): string {
  const sorted = Object.fromEntries(
    Object.entries(baseline.files).sort(([a], [b]) => a.localeCompare(b)),
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

export function excesses(actual: Baseline, allowed: Baseline): Excess[] {
  return Object.entries(actual.files).flatMap(([file, tally]) =>
    METRICS.map((metric) => ({
      file,
      metric,
      actual: tally[metric],
      allowed: (allowed.files[file] ?? ZERO)[metric],
    })).filter((entry) => entry.actual > entry.allowed),
  );
}

export const sameBaseline = (a: Baseline, b: Baseline): boolean =>
  serializeBaseline(a) === serializeBaseline(b);
