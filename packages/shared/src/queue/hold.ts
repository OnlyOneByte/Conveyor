import type { Database } from "bun:sqlite";

export function releasePrinterHold(db: Database, printerId: string): boolean {
  const { changes } = db
    .query(
      `UPDATE printers SET hold_job_id = NULL, hold_reason = NULL, hold_at = NULL
        WHERE id = ? AND hold_job_id IS NOT NULL`,
    )
    .run(printerId);
  return changes === 1;
}
