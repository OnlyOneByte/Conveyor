import type { CatalogPrinter } from "./api";
import { secretsPatch } from "./printer-secrets";

interface PrinterDraft {
  id: string;
  name: string;
  transportId: string;
  address: string;
  secret: string;
  restrict: boolean;
  allowed: string[];
}

export type DraftErrors = Partial<Record<"id" | "name" | "transportId" | "address", string>>;

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
  else if (adding && /\s|\//.test(id))
    errors.id = "Use letters, numbers and dashes, with no spaces or slashes.";
  else if (adding && taken.includes(id)) errors.id = `Another printer already uses ${id}.`;
  if (!draft.transportId) errors.transportId = "Choose the printer's software.";
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
  return {
    id,
    name,
    transportId,
    address,
    secrets: null,
    ...(allowedGenerators ? { allowedGenerators } : {}),
  };
}

const ADDRESS_HINT =
  "The IP address on the printer's screen, like 192.168.1.50. Add :port only if you changed it.";

const inSentence = (label: string) =>
  /^[A-Z][a-z]/.test(label) ? label[0]?.toLowerCase() + label.slice(1) : label;

export const addressHint = (secretsSaved: boolean, secretLabel: string) =>
  secretsSaved
    ? `${ADDRESS_HINT}\nChanging the address asks for the ${inSentence(secretLabel)} again.`
    : ADDRESS_HINT;

export const dialogTitle = (printer: CatalogPrinter | null, confirming: boolean) => {
  if (confirming) return `Delete ${printer?.name}?`;
  return printer === null ? "Add printer" : `Edit ${printer.name}`;
};

export const deleteNote = (jobs: number) => {
  if (!jobs) return "Jobs it already printed keep their history.";
  const [them, waiting] =
    jobs === 1 ? ["it", "It has a job on the belt"] : ["them", `It has ${jobs} jobs on the belt`];
  return `${waiting}. Cancel ${them} or let ${them} finish, then delete it.`;
};

export const deleteFailure = (name: string, message: string) =>
  message.includes("queued or running")
    ? `${name} still has jobs on the belt, so it can't be deleted yet.`
    : message;
