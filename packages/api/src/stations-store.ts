import type { Station } from "@conveyor/shared";
import { openDb, dbListStations, dbGetStation, dbListProfiles, type Profile } from "@conveyor/shared/db";

/**
 * SQLite-backed station catalog (docs/DATA-MODEL.md). Signatures are unchanged
 * from the M0 in-memory stub, so routes/validation are untouched; the DB is the
 * single source of truth shared with the worker.
 */
export async function listStations(): Promise<Station[]> {
  return dbListStations(openDb());
}

export async function getStation(id: string): Promise<Station | undefined> {
  return dbGetStation(openDb(), id);
}

/**
 * Profiles keyed by id, for joining a station to its bound profile. The public
 * station summary derives material/flavor from the bound profile, not from the
 * arbitrary station display name.
 */
export async function profilesById(): Promise<Map<string, Profile>> {
  return new Map(dbListProfiles(openDb()).map((p) => [p.id, p]));
}
