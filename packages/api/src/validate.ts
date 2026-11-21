import { CompatibilityError, type JobRequest, type JobTarget, validateJob } from "@conveyor/shared";
import { apiRegistry } from "./registry-view.js";

export function validateJobRequest(req: JobRequest, target: JobTarget): void {
  validateJob(req, target, apiRegistry);
}

export function validatePrinterTransport(transportId: string): void {
  if (!apiRegistry.transports.get(transportId)) {
    throw new CompatibilityError(`unknown transport: ${transportId}`);
  }
}

export function listTransports(): { id: string; name: string; acceptsFlavors: string[] }[] {
  return [...apiRegistry.transports.values()].map((t) => ({
    id: t.id,
    name: t.name,
    acceptsFlavors: [...t.acceptsFlavors],
  }));
}
