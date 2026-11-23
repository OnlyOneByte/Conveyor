import type { Database } from "bun:sqlite";
import { sealPrinterSecrets } from "./printer-secrets.js";

export interface PrinterInput {
  id: string;
  transportId: string;
  name: string;
  address: string;
  secrets?: Record<string, string>;
  allowedGenerators?: string[];
}

export interface Printer extends Omit<PrinterInput, "secrets"> {
  hasSecrets: boolean;
  lastSeenAt?: number;
  lastCheckedAt?: number;
}

export interface PrinterCheck {
  at: number;
  reachable: boolean;
}

interface PrinterRow {
  id: string;
  transport_id: string;
  name: string;
  address: string;
  secrets_json: string | null;
  allowed_generators_json: string | null;
  last_seen_at: number | null;
  last_checked_at: number | null;
}

function rowToPrinter(r: PrinterRow): Printer {
  return {
    id: r.id,
    transportId: r.transport_id,
    name: r.name,
    address: r.address,
    hasSecrets: r.secrets_json !== null,
    allowedGenerators: r.allowed_generators_json
      ? (JSON.parse(r.allowed_generators_json) as string[])
      : undefined,
    lastSeenAt: r.last_seen_at ?? undefined,
    lastCheckedAt: r.last_checked_at ?? undefined,
  };
}

export function dbGetPrinter(db: Database, id: string): Printer | undefined {
  const r = db.query("SELECT * FROM printers WHERE id = ?").get(id) as PrinterRow | null;
  return r ? rowToPrinter(r) : undefined;
}

export function dbListPrinters(db: Database): Printer[] {
  return (db.query("SELECT * FROM printers ORDER BY name").all() as PrinterRow[]).map(rowToPrinter);
}

function storedSecrets(db: Database, p: PrinterInput): string | null {
  if (!p.secrets || Object.keys(p.secrets).length === 0) return null;
  return sealPrinterSecrets(db, p.id, p.secrets);
}

export function dbUpsertPrinter(db: Database, p: PrinterInput): void {
  db.prepare(
    `INSERT INTO printers (id, transport_id, name, address, secrets_json, allowed_generators_json, created_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       transport_id=excluded.transport_id, name=excluded.name,
       address=excluded.address,
       secrets_json=IIF(?, excluded.secrets_json, printers.secrets_json),
       allowed_generators_json=excluded.allowed_generators_json`,
  ).run(
    p.id,
    p.transportId,
    p.name,
    p.address,
    storedSecrets(db, p),
    p.allowedGenerators ? JSON.stringify(p.allowedGenerators) : null,
    Date.now(),
    p.secrets !== undefined,
  );
}

export function dbDeletePrinter(db: Database, id: string): void {
  db.prepare("DELETE FROM printers WHERE id = ?").run(id);
}

export function dbRecordPrinterCheck(db: Database, id: string, check: PrinterCheck): void {
  db.prepare(
    `UPDATE printers SET
       last_checked_at = MAX(COALESCE(last_checked_at, 0), ?1),
       last_seen_at = IIF(?2, MAX(COALESCE(last_seen_at, 0), ?1), last_seen_at)
     WHERE id = ?3`,
  ).run(check.at, check.reachable, id);
}
