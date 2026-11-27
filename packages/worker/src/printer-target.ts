import type { Database } from "bun:sqlite";
import { type PrinterTarget, StageError } from "@conveyor/shared";
import { dbGetPrinter, dbGetPrinterSecrets, dbRecordPrinterCheck } from "@conveyor/shared/db";

export function resolvePrinterTarget(db: Database, printerId: string): PrinterTarget {
  return db.transaction(() => readTarget(db, printerId)).deferred();
}

function readTarget(db: Database, printerId: string): PrinterTarget {
  const printer = dbGetPrinter(db, printerId);
  if (!printer) throw new StageError("transport", `unknown printer ${printerId}`);
  const secrets = dbGetPrinterSecrets(db, printerId);
  if (!secrets.ok) {
    throw new StageError(
      "transport",
      `printer ${printerId} has stored secrets that cannot be decrypted with this CONVEYOR_SECRETS_KEY`,
    );
  }
  return {
    id: printer.id,
    transportId: printer.transportId,
    address: printer.address,
    secrets: secrets.value,
  };
}

export function markPrinterSeen(db: Database, printerId: string, at = Date.now()): void {
  dbRecordPrinterCheck(db, printerId, { at, reachable: true });
}
