import type { FormControl, FormGroup, FormUiHints } from "@conveyor/shared";

export interface JsonSchemaProp {
  type?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  enum?: unknown[];
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
  $ref?: string;
  definitions?: Record<string, JsonSchema>;
}

export type Props = Record<string, JsonSchemaProp>;

export function resolveRoot(s: JsonSchema | null): JsonSchema | null {
  if (!s) return null;
  if (s.$ref && s.definitions) {
    return s.definitions[s.$ref.replace("#/definitions/", "")] ?? s;
  }
  return s;
}

export function fieldLabel(key: string, p: JsonSchemaProp): string {
  return p.description ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

export const lo = (p: JsonSchemaProp): number => p.minimum ?? Number.NEGATIVE_INFINITY;
export const hi = (p: JsonSchemaProp): number => p.maximum ?? Number.POSITIVE_INFINITY;
export const clamp = (n: number, p: JsonSchemaProp): number => Math.min(hi(p), Math.max(lo(p), n));

export function typedValue(p: JsonSchemaProp, raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  let n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  if (p.type === "integer") n = Math.trunc(n);
  return n >= lo(p) && n <= hi(p) ? n : undefined;
}

export function settledValue(p: JsonSchemaProp, raw: string, fallback: number): number {
  let n = raw.trim() === "" ? fallback : Number(raw.trim());
  if (!Number.isFinite(n)) n = fallback;
  if (p.type === "integer") n = Math.trunc(n);
  return clamp(n, p);
}

export function numOf(props: Props, value: Record<string, unknown>, key: string): number {
  const p = props[key];
  return Number(value[key] ?? p?.default ?? p?.minimum ?? 0);
}

export function controlFor(key: string, p: JsonSchemaProp, ui: FormUiHints | null): FormControl {
  const forced = ui?.controls?.[key];
  if (forced) return forced;
  if (p.type === "boolean") return "checkbox";
  if (p.minimum !== undefined && p.maximum !== undefined) return "slider";
  return "stepper";
}

export function groupSummary(
  gr: FormGroup,
  props: Props,
  value: Record<string, unknown>,
  ui: FormUiHints | null,
): string {
  const mm = ui?.unitMm ?? {};
  const fields = gr.fields.filter((f) => props[f]);
  if (!fields.length) return "";
  if (fields.every((f) => typeof mm[f] === "number")) {
    return `${fields.map((f) => Math.round(numOf(props, value, f) * (mm[f] as number))).join(" × ")} mm`;
  }
  const numeric = fields.filter((f) => {
    const t = props[f]?.type;
    return t === "integer" || t === "number";
  });
  if (fields.length > 1 && numeric.length === fields.length) {
    return fields.map((f) => numOf(props, value, f)).join(" × ");
  }
  return "";
}

export function primaryGroups(props: Props, ui: FormUiHints | null): FormGroup[] {
  const keys = Object.keys(props);
  if (!ui?.groups?.length) return [{ fields: keys, layout: "stack" }];
  const seen = new Set<string>();
  for (const g of ui.groups) for (const f of g.fields) seen.add(f);
  for (const g of ui.advanced?.groups ?? []) for (const f of g.fields) seen.add(f);
  const leftover = keys.filter((k) => !seen.has(k));
  return leftover.length ? [...ui.groups, { fields: leftover, layout: "stack" }] : ui.groups;
}
