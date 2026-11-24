import type { JobStatusEvent, Stage } from "@conveyor/shared";
import type { StageDurations } from "@conveyor/shared/db";

export interface ActiveJob {
  event: JobStatusEvent;
  printerId: string;
  generatorId: string;
  createdAt: number;
}

export type JobEstimate = { typicalMs?: StageDurations; startsAt?: number };

const STAGE_ORDER: readonly Stage[] = ["generator", "slicer", "transport"];

function sumFrom(typical: StageDurations, first: number): number | undefined {
  let sum = 0;
  for (const stage of STAGE_ORDER.slice(first)) {
    const ms = typical[stage];
    if (ms === undefined) return undefined;
    sum += ms;
  }
  return sum;
}

function remainingMs({ event }: ActiveJob, typical: StageDurations, now: number) {
  const left = event.print?.secondsLeft;
  if (event.state === "printing")
    return left === undefined ? undefined : event.at + left * 1000 - now;
  const stage = event.state === "queued" ? "generator" : (event.stage ?? "generator");
  return sumFrom(typical, STAGE_ORDER.indexOf(stage));
}

function startTimes(jobs: ActiveJob[], typical: Map<ActiveJob, StageDurations>, now: number) {
  const starts = new Map<ActiveJob, number>();
  for (const group of Map.groupBy(jobs, (job) => job.printerId).values()) {
    let waitMs: number | undefined = 0;
    for (const running of group.filter((job) => job.event.state !== "queued")) {
      const left = remainingMs(running, typical.get(running) ?? {}, now);
      waitMs = waitMs === undefined || left === undefined ? undefined : Math.max(waitMs, left);
    }
    const queued = group
      .filter((job) => job.event.state === "queued")
      .sort((a, b) => a.createdAt - b.createdAt || a.event.jobId.localeCompare(b.event.jobId));
    for (const job of queued) {
      if (waitMs === undefined) break;
      starts.set(job, now + waitMs);
      const own = remainingMs(job, typical.get(job) ?? {}, now);
      waitMs = own === undefined ? undefined : waitMs + own;
    }
  }
  return starts;
}

export function withEstimates(
  jobs: ActiveJob[],
  lookup: (job: ActiveJob) => StageDurations,
  now: number,
): (JobStatusEvent & { estimate?: JobEstimate })[] {
  const typical = new Map(jobs.map((job) => [job, lookup(job)] as const));
  const starts = startTimes(jobs, typical, now);
  return jobs.map((job) => {
    const typicalMs = typical.get(job) ?? {};
    const startsAt = starts.get(job);
    const estimate: JobEstimate = {
      ...(Object.keys(typicalMs).length > 0 && { typicalMs }),
      ...(startsAt !== undefined && { startsAt }),
    };
    return Object.keys(estimate).length > 0 ? { ...job.event, estimate } : job.event;
  });
}
