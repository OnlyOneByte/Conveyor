import { validateJob, CompatibilityError, type JobRequest, type Station } from "@conveyor/shared";
import { openDb, dbListProfiles } from "@conveyor/shared/db";
import { apiRegistry } from "./registry-view.js";

/**
 * Run the shared capability check against the API's lightweight view of the
 * registry. The API only needs plugin *capabilities* (formats/flavors/profiles),
 * not the heavy adapter implementations — those live in the worker.
 */
export function validateJobRequest(req: JobRequest, station: Station): void {
  validateJob(req, station, apiRegistry);
}

/**
 * Validate a Station at admin-create time (DATA-MODEL.md invariant): the slicer,
 * transport and profile must exist and interoperate, so an unprintable Station
 * can never be saved. Mirrors the job-time check but on the config itself.
 */
export function validateStation(station: Station): void {
  const slicer = apiRegistry.slicers.get(station.slicerId);
  if (!slicer) throw new CompatibilityError(`unknown slicer: ${station.slicerId}`);

  const transport = apiRegistry.transports.get(station.transportId);
  if (!transport) throw new CompatibilityError(`unknown transport: ${station.transportId}`);

  const profile = dbListProfiles(openDb()).find((p) => p.id === station.profileId);
  if (!profile) throw new CompatibilityError(`unknown profile: ${station.profileId}`);

  if (profile.slicerId !== station.slicerId) {
    throw new CompatibilityError(
      `profile ${profile.id} belongs to slicer ${profile.slicerId}, not ${station.slicerId}`,
    );
  }
  if (!transport.acceptsFlavors.includes(profile.gcodeFlavor)) {
    throw new CompatibilityError(
      `profile ${profile.id} emits ${profile.gcodeFlavor} but transport ${transport.id} accepts [${transport.acceptsFlavors}]`,
    );
  }
}
