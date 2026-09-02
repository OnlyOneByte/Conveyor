import { validateJob, CompatibilityError, type JobRequest, type JobTarget } from "@conveyor/shared";
import { apiRegistry } from "./registry-view.js";

/**
 * Run the shared capability check against the API's lightweight view of the
 * registry. The API only needs plugin *capabilities* (formats/flavors/profiles),
 * not the heavy adapter implementations — those live in the worker.
 */
export function validateJobRequest(req: JobRequest, target: JobTarget): void {
  validateJob(req, target, apiRegistry);
}

/**
 * Validate a Printer's transport on write. printerSchema only checks that
 * transportId is a non-empty string, so a typo used to persist happily and produce
 * a printer no job could ever print through — the failure surfaced much later,
 * at job submit, as an unrelated-looking compatibility error.
 */
export function validatePrinterTransport(transportId: string): void {
  if (!apiRegistry.transports.get(transportId)) {
    throw new CompatibilityError(`unknown transport: ${transportId}`);
  }
}

/** Registered transports, for the Settings printer form's picker. */
export function listTransports(): { id: string; name: string; acceptsFlavors: string[] }[] {
  return [...apiRegistry.transports.values()].map((t) => ({
    id: t.id,
    name: t.name,
    acceptsFlavors: [...t.acceptsFlavors],
  }));
}
