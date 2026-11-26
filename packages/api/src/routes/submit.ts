import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { JobRequest } from "@conveyor/shared";
import { dbClaimRetry, dbRetriedBy } from "@conveyor/shared/db";
import type { FastifyBaseLogger } from "fastify";

type Submission = { request: JobRequest; retryOf?: string };
type Submitted =
  | { code: 202; body: { jobId: string } }
  | { code: 409; body: { error: string; retriedBy: string | null } };

function alreadyRetried(db: Database, retryOf: string): Submitted {
  const error = `retryOf: job ${retryOf} was already retried`;
  return { code: 409, body: { error, retriedBy: dbRetriedBy(db, retryOf) } };
}

export async function submitJob(
  db: Database,
  submission: Submission,
  enqueue: (jobId: string, request: JobRequest) => unknown,
): Promise<Submitted> {
  const jobId = randomUUID();
  const { retryOf } = submission;
  if (retryOf && !dbClaimRetry(db, retryOf, jobId)) return alreadyRetried(db, retryOf);
  await enqueue(jobId, submission.request);
  return { code: 202, body: { jobId } };
}

export function submitJobInTransaction(
  db: Database,
  submission: Submission,
  enqueue: (jobId: string, request: JobRequest) => void,
): Submitted {
  const jobId = randomUUID();
  const { retryOf } = submission;
  return db
    .transaction((): Submitted => {
      if (retryOf && !dbClaimRetry(db, retryOf, jobId)) return alreadyRetried(db, retryOf);
      enqueue(jobId, submission.request);
      return { code: 202, body: { jobId } };
    })
    .immediate();
}

export function logSubmitted(log: FastifyBaseLogger, submission: Submission, result: Submitted) {
  const { generator, printerId } = submission.request;
  const retryOf = submission.retryOf;
  if (result.code === 202)
    log.info(
      { jobId: result.body.jobId, generatorId: generator.id, printerId, retryOf },
      "job queued",
    );
  else
    log.info({ retryOf, retriedBy: result.body.retriedBy }, "job retry refused: already retried");
}

export function logCancel(log: FastifyBaseLogger, jobId: string, code: number) {
  log.info({ jobId, code }, "job cancel requested");
}
