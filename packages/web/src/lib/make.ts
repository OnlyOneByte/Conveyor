import type { FormUiHints } from "@conveyor/shared";
import { type JsonSchema, resolveRoot } from "./form-schema.js";

export function printerStatus(
  id: string,
  busy: Set<string> | null,
  unreachable: Set<string>,
  answered: Set<string>,
): string {
  if (unreachable.has(id)) return "Not reachable";
  if (!busy) return "";
  if (busy.has(id)) return "Busy";
  return answered.has(id) ? "Ready" : "";
}

export function measurements(params: Record<string, unknown>, ui: FormUiHints | null): string {
  const units = ui?.unitMm ?? {};
  const sizes = (ui?.groups ?? []).flatMap(({ fields }) =>
    fields.flatMap((field) => {
      const value = params[field];
      const unit = units[field];
      return typeof value === "number" && unit !== undefined ? [value * unit] : [];
    }),
  );
  return sizes.length ? `${sizes.join(" × ")} mm` : "";
}

const KB = 1024;

export function fileSize(bytes: number): string {
  if (bytes < KB * KB) return `${Math.max(1, Math.round(bytes / KB))} KB`;
  return `${(bytes / KB / KB).toFixed(1)} MB`;
}

export const dockLine = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" · ");

type Outcome<R> = { ok: true; value: R } | { ok: false; error: unknown };

export function latestOnly<A, R>(run: (arg: A) => Promise<R>) {
  let turn = 0;
  return {
    drop: () => void ++turn,
    async run(arg: A): Promise<Outcome<R> | null> {
      const mine = ++turn;
      const outcome = await run(arg).then(
        (value): Outcome<R> => ({ ok: true, value }),
        (error: unknown): Outcome<R> => ({ ok: false, error }),
      );
      return mine === turn ? outcome : null;
    },
  };
}

export function knownParams(params: unknown, schema: JsonSchema | null): Record<string, unknown> {
  if (!params || typeof params !== "object") return {};
  const known = resolveRoot(schema)?.properties ?? {};
  return Object.fromEntries(Object.entries(params).filter(([key]) => Object.hasOwn(known, key)));
}
