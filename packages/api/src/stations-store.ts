import type { Station } from "@conveyor/shared";
import { openDb, dbListStations, dbGetStation } from "@conveyor/shared/db";

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
