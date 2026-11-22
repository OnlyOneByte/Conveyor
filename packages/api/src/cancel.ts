import { isTerminal, type JobRequest, type JobState, type JobStatusEvent } from "@conveyor/shared";

export interface CancelableJob {
  data: JobRequest;
  getState(): Promise<string>;
  remove(): Promise<void>;
}

export interface CancelDeps {
  getJob(jobId: string): Promise<CancelableJob | undefined>;
  readSnapshot(jobId: string): Promise<JobStatusEvent | undefined>;
  requestCancel(jobId: string): Promise<void>;
  settleCanceled(jobId: string, req: JobRequest): Promise<boolean>;
}

interface CancelResult {
  code: 200 | 202 | 404;
  body: { ok: boolean; jobId: string; state?: JobState | "canceling"; error?: string };
}

const REMOVABLE = new Set(["waiting", "delayed", "prioritized", "waiting-children", "paused"]);

export async function cancelJob(jobId: string, deps: CancelDeps): Promise<CancelResult> {
  const settled = async (): Promise<CancelResult | undefined> => {
    const snap = await deps.readSnapshot(jobId);
    if (snap && isTerminal(snap.state))
      return { code: 200, body: { ok: true, jobId, state: snap.state } };
    return undefined;
  };

  const before = await settled();
  if (before) return before;

  const job = await deps.getJob(jobId);
  if (!job) {
    const snap = await deps.readSnapshot(jobId);
    if (!snap) return { code: 404, body: { ok: false, jobId, error: "unknown job" } };
    await deps.requestCancel(jobId);
    return { code: 202, body: { ok: true, jobId, state: "canceling" } };
  }

  await deps.requestCancel(jobId);
  const state = await job.getState();

  if (REMOVABLE.has(state)) {
    const removed = await job.remove().then(
      () => true,
      () => false,
    );
    if (removed) {
      await deps.settleCanceled(jobId, job.data);
      return (await settled()) ?? { code: 200, body: { ok: true, jobId, state: "canceled" } };
    }
  }

  if (state === "completed" || state === "failed") {
    return (await settled()) ?? { code: 202, body: { ok: true, jobId, state: "canceling" } };
  }

  return { code: 202, body: { ok: true, jobId, state: "canceling" } };
}
