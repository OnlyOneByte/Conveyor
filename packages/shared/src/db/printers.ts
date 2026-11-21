import type { Database } from "bun:sqlite";
import { epochMs } from "./epoch-ms.js";

export interface Printer {
  id: string;
  transportId: string;
  name: string;
  address: string;
  secrets?: Record<string, string>;
  allowedGenerators?: string[];
}

interface PrinterRow {
  id: string;
  transport_id: string;
  name: string;
  address: string;
  secrets_json: string | null;
  allowed_generators_json: string | null;
}

function rowToPrinter(r: PrinterRow): Printer {
  return {
    id: r.id,
    transportId: r.transport_id,
    name: r.name,
    address: r.address,
    secrets: r.secrets_json ? JSON.parse(r.secrets_json) : undefined,
    allowedGenerators: r.allowed_generators_json
      ? (JSON.parse(r.allowed_generators_json) as string[])
      : undefined,
  };
}

export function dbGetPrinter(db: Database, id: string): Printer | undefined {
  const r = db.query("SELECT * FROM printers WHERE id = ?").get(id) as PrinterRow | null;
  return r ? rowToPrinter(r) : undefined;
}

export function dbListPrinters(db: Database): Printer[] {
  return (db.query("SELECT * FROM printers ORDER BY name").all() as PrinterRow[]).map(rowToPrinter);
}

export function dbUpsertPrinter(db: Database, p: Printer): void {
  db.prepare(
    `INSERT INTO printers (id, transport_id, name, address, secrets_json, allowed_generators_json, created_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       transport_id=excluded.transport_id, name=excluded.name,
       address=excluded.address,
       secrets_json=COALESCE(excluded.secrets_json, printers.secrets_json),
       allowed_generators_json=excluded.allowed_generators_json`,
  ).run(
    p.id,
    p.transportId,
    p.name,
    p.address,
    p.secrets ? JSON.stringify(p.secrets) : null,
    p.allowedGenerators ? JSON.stringify(p.allowedGenerators) : null,
    epochMs(),
  );
}

export function dbDeletePrinter(db: Database, id: string): void {
  db.prepare("DELETE FROM printers WHERE id = ?").run(id);
}
