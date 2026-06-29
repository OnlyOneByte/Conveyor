import { validateJob, type JobRequest, type Station } from "@conveyor/shared";
import { apiRegistry } from "./registry-view.js";

/**
 * Run the shared capability check against the API's lightweight view of the
 * registry. The API only needs plugin *capabilities* (formats/flavors/profiles),
 * not the heavy adapter implementations — those live in the worker.
 */
export function validateJobRequest(req: JobRequest, station: Station): void {
  validateJob(req, station, apiRegistry);
}
