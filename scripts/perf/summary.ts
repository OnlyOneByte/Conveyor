import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const METRICS = [
  { audit: "interactive", label: "Time to interactive" },
  { audit: "first-contentful-paint", label: "First contentful paint" },
  { audit: "largest-contentful-paint", label: "Largest contentful paint" },
  { audit: "total-blocking-time", label: "Total blocking time" },
] as const;

type Audit = (typeof METRICS)[number]["audit"];
export type Run = Partial<Record<Audit, number>>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function readRun(text: string): Run | null {
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed) || parsed.runtimeError !== undefined || !isObject(parsed.audits))
    return null;
  const { audits } = parsed;
  const run: Run = {};
  for (const { audit } of METRICS) {
    const entry = audits[audit];
    if (isObject(entry) && typeof entry.numericValue === "number") run[audit] = entry.numericValue;
  }
  return run;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] ?? null)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const ms = (value: number | null) =>
  value === null ? "n/a" : `${Math.round(value).toLocaleString("en-US")} ms`;

function delta(base: number | null, head: number | null): string {
  if (base === null || head === null) return "n/a";
  const diff = Math.round(head - base) || 0;
  return `${diff > 0 ? "+" : ""}${diff.toLocaleString("en-US")} ms`;
}

export function summarize(
  base: Run[],
  head: Run[],
  names = { base: "base", head: "head" },
): string {
  const rows = METRICS.map(({ audit, label }) => {
    const b = median(base.flatMap((run) => run[audit] ?? []));
    const h = median(head.flatMap((run) => run[audit] ?? []));
    return `| ${label} | ${ms(b)} | ${ms(h)} | ${delta(b, h)} |`;
  });
  return [
    `| Median | ${names.base} (${base.length} runs) | ${names.head} (${head.length} runs) | Change |`,
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function runsIn(dir: string, variant: string): Run[] {
  return readdirSync(dir)
    .filter((name) => name.startsWith(`${variant}-`) && name.endsWith(".json"))
    .flatMap((name) => readRun(readFileSync(join(dir, name), "utf8")) ?? []);
}

if (import.meta.main) {
  const [dir, baseName = "base", headName = "head"] = Bun.argv.slice(2);
  if (!dir) throw new Error("usage: bun scripts/perf/summary.ts <dir> [base name] [head name]");
  console.log(
    summarize(runsIn(dir, "base"), runsIn(dir, "head"), { base: baseName, head: headName }),
  );
}
