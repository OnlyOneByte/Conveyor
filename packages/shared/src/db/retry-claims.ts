import type { Database } from "bun:sqlite";

export interface RetryClaim {
  id: string;
  retriedBy: string;
}

export function dbListUnrecordedRetryClaims(db: Database): RetryClaim[] {
  return db
    .query<{ id: string; retried_by: string }, []>(
      `SELECT j.id, j.retried_by FROM jobs j
        WHERE j.retried_by IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM jobs r WHERE r.id = j.retried_by)`,
    )
    .all()
    .map((row) => ({ id: row.id, retriedBy: row.retried_by }));
}

export function dbRetryOf(db: Database, retryId: string): string | null {
  return (
    db.query<{ id: string }, [string]>("SELECT id FROM jobs WHERE retried_by = ?").get(retryId)
      ?.id ?? null
  );
}
