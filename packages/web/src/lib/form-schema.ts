// Shared plumbing for the schema-driven config form: the JSON Schema shapes we
// actually consume, plus the pure helpers SchemaForm and SchemaGroup both need.
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

/** zod-to-json-schema wraps the object behind $ref → definitions[name]. Resolve it. */
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

/** Current numeric value of a field, falling back to its default then its minimum. */
export function numOf(props: Props, value: Record<string, unknown>, key: string): number {
  const p = props[key];
  return Number(value[key] ?? p?.default ?? p?.minimum ?? 0);
}

/** Which control to render. Explicit hint wins; otherwise infer from the schema. */
export function controlFor(key: string, p: JsonSchemaProp, ui: FormUiHints | null): FormControl {
  const forced = ui?.controls?.[key];
  if (forced) return forced;
  if (p.type === "boolean") return "checkbox";
  if (p.minimum !== undefined && p.maximum !== undefined) return "slider";
  return "stepper";
}

/**
 * Right-aligned readout beside a group heading. When every field in the group has a
 * millimetre-per-unit mapping we show real millimetres (the number you measure a
 * drawer against); a numeric pair without one just echoes its values, e.g. "1 × 1".
 */
export function groupSummary(
  gr: FormGroup, props: Props, value: Record<string, unknown>, ui: FormUiHints | null,
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

/**
 * Render plan for the primary (always-visible) section. Any field the hints forget is
 * appended as a visible group rather than dropped — a stray control is a much better
 * failure mode than a silently missing parameter.
 */
export function primaryGroups(props: Props, ui: FormUiHints | null): FormGroup[] {
  const keys = Object.keys(props);
  if (!ui?.groups?.length) return [{ fields: keys, layout: "stack" }];
  const seen = new Set<string>();
  for (const g of ui.groups) for (const f of g.fields) seen.add(f);
  for (const g of ui.advanced?.groups ?? []) for (const f of g.fields) seen.add(f);
  const leftover = keys.filter((k) => !seen.has(k));
  return leftover.length ? [...ui.groups, { fields: leftover, layout: "stack" }] : ui.groups;
}
