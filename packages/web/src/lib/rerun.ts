import type { JobState } from "@conveyor/shared";
import { type JobHistoryEntry, submitJob } from "./api";
import { retryJob } from "./retry";

const KEY = "conveyor.rerun";

export interface RerunPayload {
  generatorId: string;
  params?: unknown;
  printerId: string;
  profileId: string;
  retryOf?: string;
}

interface Rerunnable {
  state: JobState;
  request: { generator: { id: string; params?: unknown }; printerId: string; profileId: string };
}

export const linkedRetry = (
  handoff: RerunPayload | null,
  source: string,
  generatorId: string | undefined,
) =>
  handoff?.retryOf && source === "generate" && generatorId === handoff.generatorId
    ? handoff.retryOf
    : undefined;

export const ALREADY_RETRIED = "This job was already retried.";

export class AlreadyRetried extends Error {
  retriedBy: string | null;

  constructor(retriedBy: string | null) {
    super(ALREADY_RETRIED);
    this.retriedBy = retriedBy;
  }
}

export async function sendJob(
  request: Rerunnable["request"],
  retryOf?: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ jobId: string }> {
  if (!retryOf)
    return submitJob({
      ...request,
      generator: { ...request.generator, params: request.generator.params },
    });
  const retried = await retryJob({ id: retryOf, request }, fetchFn);
  if (retried.ok) return { jobId: retried.jobId };
  if (retried.status === 409 && !retried.held) throw new AlreadyRetried(retried.retriedBy ?? null);
  throw new Error(retried.error);
}

export function rerunRequest({ state, request }: Rerunnable): Rerunnable["request"] | null {
  const settled = state === "done" || state === "canceled";
  return settled && request.generator.id !== "passthrough" && request.printerId && request.profileId
    ? request
    : null;
}

export function stashRerun(p: RerunPayload): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    return;
  }
}

export function rerunOnMake(
  { generator, printerId, profileId }: JobHistoryEntry["request"],
  retryOf: string,
): void {
  stashRerun({
    generatorId: generator.id,
    params: generator.params,
    printerId,
    profileId,
    retryOf,
  });
  location.assign("/?rerun=1");
}

export function takeRerun(): RerunPayload | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as RerunPayload;
  } catch {
    return null;
  }
}
