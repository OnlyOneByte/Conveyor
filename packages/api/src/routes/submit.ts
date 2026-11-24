import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { JobRequest } from "@conveyor/shared";
import { dbClaimRetry, dbReleaseRetry } from "@conveyor/shared/db";

export async function submitJob(
  db: Database,
  submission: { request: JobRequest; retryOf?: string },
  enqueue: (jobId: string, request: JobRequest) => unknown,
): Promise<{ code: 202; body: { jobId: string } } | { code: 409; body: { error: string } }> {
  const jobId = randomUUID();
  const { retryOf } = submission;
  if (retryOf && !dbClaimRetry(db, retryOf, jobId)) {
    return { code: 409, body: { error: `retryOf: job ${retryOf} is already being retried` } };
  }
  try {
    await enqueue(jobId, submission.request);
  } catch (err) {
    if (retryOf) dbReleaseRetry(db, retryOf, jobId);
    throw err;
  }
  return { code: 202, body: { jobId } };
}
