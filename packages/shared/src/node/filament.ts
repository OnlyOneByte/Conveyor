import type { FilamentUse } from "../job.js";

const TAIL_BYTES = 512 * 1024;
const MM_PER_METRE = 1000;

const FIELDS = {
  totalGrams: /^; total filament used \[g\] = (.+)$/m,
  grams: /^; filament used \[g\] = (.+)$/m,
  millimetres: /^; filament used \[mm\] = (.+)$/m,
} as const;

function amount(text: string, field: RegExp): number | undefined {
  const values = field.exec(text)?.[1]?.split(",");
  if (!values) return undefined;
  let sum = 0;
  for (const value of values) {
    const n = Number(value.trim());
    if (value.trim() === "" || !Number.isFinite(n) || n < 0) return undefined;
    sum += n;
  }
  return sum > 0 ? sum : undefined;
}

export function parseFilamentUse(text: string): FilamentUse | undefined {
  const grams = amount(text, FIELDS.totalGrams) ?? amount(text, FIELDS.grams);
  const millimetres = amount(text, FIELDS.millimetres);
  const use: FilamentUse = {};
  if (grams !== undefined) use.grams = Math.round(grams * 100) / 100;
  if (millimetres !== undefined) use.metres = Math.round(millimetres) / MM_PER_METRE;
  return Object.keys(use).length > 0 ? use : undefined;
}

export async function readFilamentUse(path: string): Promise<FilamentUse | undefined> {
  const file = Bun.file(path);
  const tail = file.size <= TAIL_BYTES ? file : file.slice(-TAIL_BYTES);
  return parseFilamentUse(await tail.text());
}
