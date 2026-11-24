import type { CatalogPrinter } from "./api";
import { secretsPatch } from "./printer-secrets";

export interface PrinterDraft {
  id: string;
  name: string;
  transportId: string;
  address: string;
  secret: string;
  restrict: boolean;
  allowed: string[];
}

export type DraftErrors = Partial<Record<"id" | "name" | "transportId" | "address", string>>;

export const FIELD_ORDER = ["name", "id", "transportId", "address"] as const;

export const blankDraft = (transportId = ""): PrinterDraft => ({
  id: "",
  name: "",
  transportId,
  address: "",
  secret: "",
  restrict: false,
  allowed: [],
});

export const draftOf = (printer: CatalogPrinter): PrinterDraft => ({
  id: printer.id,
  name: printer.name,
  transportId: printer.transportId,
  address: printer.address,
  secret: "",
  restrict: printer.allowedGenerators !== undefined,
  allowed: [...(printer.allowedGenerators ?? [])],
});

export function slugOf(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function draftErrors(draft: PrinterDraft, taken: string[], adding: boolean): DraftErrors {
  const errors: DraftErrors = {};
  const id = draft.id.trim();
  if (!draft.name.trim()) errors.name = "Give the printer a name.";
  if (adding && !id) errors.id = "Give the printer an ID.";
  else if (adding && /\s|\//.test(id)) errors.id = "Use letters, numbers and dashes, with no spaces or slashes.";
  else if (adding && taken.includes(id)) errors.id = `Another printer already uses ${id}.`;
  if (!draft.transportId) errors.transportId = "Choose how Conveyor talks to the printer.";
  if (!draft.address.trim()) errors.address = "Enter the printer's address.";
  else if (/\s/.test(draft.address.trim())) errors.address = "An address can't contain spaces.";
  return errors;
}

export function printerPayload(draft: PrinterDraft) {
  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    transportId: draft.transportId,
    address: draft.address.trim(),
    ...secretsPatch(draft.transportId, draft.secret),
    ...(draft.restrict ? { allowedGenerators: [...draft.allowed] } : {}),
  };
}

export function clearSecretsPayload(printer: CatalogPrinter) {
  const { id, name, transportId, address, allowedGenerators } = printer;
  return { id, name, transportId, address, secrets: null, ...(allowedGenerators ? { allowedGenerators } : {}) };
}
