import type { FormUiHints } from "@conveyor/shared";
import {
  fieldLabel,
  groupSummary,
  type JsonSchema,
  primaryGroups,
  resolveRoot,
} from "./form-schema.js";

export interface SettingRow {
  key: string;
  label: string;
  value: string;
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function orderedKeys(
  params: Record<string, unknown>,
  ui: FormUiHints | null,
  schemaKeys: string[],
): string[] {
  const hinted = [...(ui?.groups ?? []), ...(ui?.advanced?.groups ?? [])].flatMap((g) => g.fields);
  return [...new Set([...hinted, ...schemaKeys, ...Object.keys(params)])].filter(
    (k) => k in params,
  );
}

function formatValue(value: unknown, mmPerUnit: number | undefined): string | null {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    return mmPerUnit === undefined
      ? String(value)
      : `${value} u · ${Math.round(value * mmPerUnit)} mm`;
  }
  if (typeof value === "string") return value;
  return null;
}

export function settingRows(
  params: unknown,
  schema: JsonSchema | null,
  ui: FormUiHints | null,
): SettingRow[] {
  if (!isRecord(params)) return [];
  const props = resolveRoot(schema)?.properties ?? {};
  return orderedKeys(params, ui, Object.keys(props)).flatMap((key) => {
    if (key.endsWith("Id")) return [];
    const value = formatValue(params[key], ui?.unitMm?.[key]);
    if (value === null) return [];
    return [{ key, label: fieldLabel(key, props[key] ?? {}), value }];
  });
}

export function jobName(
  generatorName: string,
  params: unknown,
  schema: JsonSchema | null,
  ui: FormUiHints | null,
): string {
  if (!isRecord(params)) return generatorName;
  if (typeof params.filename === "string") return params.filename;
  const props = resolveRoot(schema)?.properties ?? {};
  const first = primaryGroups(props, ui)[0];
  const size =
    first && ui?.groups?.length ? groupSummary(first, props, params, { ...ui, unitMm: {} }) : "";
  return size ? `${generatorName} ${size}` : generatorName;
}

export function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${minutes / 60} h`;
}
