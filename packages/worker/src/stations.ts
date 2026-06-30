import type { Station } from "@conveyor/shared";
import { openDb, dbGetStation } from "@conveyor/shared/db";

/**
 * SQLite-backed station resolution (docs/DATA-MODEL.md), shared with the API.
 * Signature unchanged from the M0 stub so the worker pipeline is untouched.
 */
export async function resolveStation(id: string): Promise<Station> {
  const s = dbGetStation(openDb(), id);
  if (!s) throw new Error(`unknown station ${id}`);
  return s;
}
