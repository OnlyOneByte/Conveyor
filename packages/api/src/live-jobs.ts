import type { Database } from "bun:sqlite";

export type JobReference = "printerId" | "profileId";

export type LiveJobCounter = (reference: JobReference, id: string) => Promise<number>;

const LIVE_JOBS_SQL: Record<JobReference, string> = {
  printerId:
    "SELECT COUNT(*) AS n FROM jobs WHERE printer_id = ? AND state NOT IN ('done', 'failed', 'canceled')",
  profileId:
    "SELECT COUNT(*) AS n FROM jobs WHERE profile_id = ? AND state NOT IN ('done', 'failed', 'canceled')",
};

export function countSqliteLiveJobs(db: Database): LiveJobCounter {
  return async (reference, id) =>
    db.query<{ n: number }, [string]>(LIVE_JOBS_SQL[reference]).get(id)?.n ?? 0;
}
