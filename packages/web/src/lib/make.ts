import type { FormUiHints } from "@conveyor/shared";

export function printerStatus(id: string, busy: Set<string>, unreachable: Set<string>): string {
  if (unreachable.has(id)) return "Not reachable";
  return busy.has(id) ? "Busy" : "Ready";
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

export const dockLine = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" · ");
