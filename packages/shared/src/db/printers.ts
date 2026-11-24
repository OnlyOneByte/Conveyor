import type { Database } from "bun:sqlite";
import { dbGetPrinterSecrets, sealPrinterSecrets } from "./printer-secrets.js";

export const MAX_PRINTER_SECRETS = 16;

export type PrinterSecretsPatch = Record<string, string | null>;

export interface PrinterInput {
  id: string;
  transportId: string;
  name: string;
  address: string;
  secrets?: PrinterSecretsPatch | null;
  allowedGenerators?: string[];
}

export class PrinterSecretsWriteError extends Error {
  override name = "PrinterSecretsWriteError";
  constructor(
    readonly kind: "TooManySecrets" | "StoredSecretsUnreadable",
    message: string,
  ) {
    super(message);
  }
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

function mergedSecrets(db: Database, id: string, patch: PrinterSecretsPatch): string | null {
  const stored = dbGetPrinterSecrets(db, id);
  if (!stored.ok) {
    throw new PrinterSecretsWriteError(
      "StoredSecretsUnreadable",
      `printer ${id}'s stored secrets can't be read, so they can't be updated; clear its saved secrets and enter them again`,
    );
  }
  const merged = { ...stored.value };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  if (Object.keys(merged).length > MAX_PRINTER_SECRETS) {
    throw new PrinterSecretsWriteError(
      "TooManySecrets",
      `secrets: at most ${MAX_PRINTER_SECRETS} secrets per printer, counting the ones already stored`,
    );
  }
  return Object.keys(merged).length === 0 ? null : sealPrinterSecrets(db, id, merged);
}

export function dbUpsertPrinter(db: Database, p: PrinterInput): void {
  db.transaction(() => upsertPrinter(db, p)).immediate();
}

function upsertPrinter(db: Database, p: PrinterInput): void {
  const secrets = p.secrets ? mergedSecrets(db, p.id, p.secrets) : null;
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
    secrets,
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
