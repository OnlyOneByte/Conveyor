import type { Database } from "bun:sqlite";

export function holdPrinter(
  db: Database,
  hold: { printerId: string | null; jobId: string; reason: string; at: number },
): void {
  db.query(
    "UPDATE printers SET hold_job_id = ?, hold_reason = ?, hold_at = ? WHERE id = ? AND hold_job_id IS NULL",
  ).run(hold.jobId, hold.reason, hold.at, hold.printerId);
}

export function printerHoldReason(db: Database, printerId: string): string | null {
  const row = db
    .query<{ hold_reason: string | null }, [string]>(
      "SELECT hold_reason FROM printers WHERE id = ? AND hold_job_id IS NOT NULL",
    )
    .get(printerId);
  return row ? (row.hold_reason ?? "held") : null;
}

export function releasePrinterHold(db: Database, printerId: string): boolean {
  const { changes } = db
    .query(
      `UPDATE printers SET hold_job_id = NULL, hold_reason = NULL, hold_at = NULL
        WHERE id = ? AND hold_job_id IS NOT NULL`,
    )
    .run(printerId);
  return changes === 1;
}

export function heldPrinterIds(db: Database): Set<string> {
  return new Set(
    db
      .query<{ id: string }, []>("SELECT id FROM printers WHERE hold_job_id IS NOT NULL")
      .all()
      .map((p) => p.id),
  );
}
