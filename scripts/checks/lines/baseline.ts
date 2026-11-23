import type { Counts } from "./count";

export const BASELINE_PATH = "scripts/checks/lines/baseline.json";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

export function parseBaseline(text: string): Counts | null {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || !isRecord(value.files)) return null;
    const entries = Object.entries(value.files);
    if (!entries.every(([, lines]) => isCount(lines))) return null;
    return Object.fromEntries(
      entries.filter((entry): entry is [string, number] => isCount(entry[1])),
    );
  } catch {
    return null;
  }
}

export function serializeBaseline(counts: Counts): string {
  const files = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify({ files }, null, 2)}\n`;
}
