import type { JobStatusEvent, Stage } from "@conveyor/shared";
import type { StageDurations } from "@conveyor/shared/db";

export interface ActiveJob {
  event: JobStatusEvent;
  printerId: string;
  generatorId: string;
  createdAt: number;
}

export interface JobEstimate {
  typicalMs?: StageDurations;
  startsAt?: number;
}

export type TypicalLookup = (job: ActiveJob) => StageDurations;

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

function remainingMs(job: ActiveJob, typical: StageDurations, now: number): number | undefined {
  const { event } = job;
  if (event.state === "printing") {
    const left = event.print?.secondsLeft;
    return left === undefined ? undefined : event.at + left * 1000 - now;
  }
  if (event.state === "queued") return sumFrom(typical, 0);
  return sumFrom(typical, Math.max(0, STAGE_ORDER.indexOf(event.stage ?? "generator")));
}

function startTimes(jobs: ActiveJob[], typical: Map<ActiveJob, StageDurations>, now: number) {
  const starts = new Map<ActiveJob, number>();
  const queued = jobs
    .filter((job) => job.event.state === "queued")
    .sort((a, b) => a.createdAt - b.createdAt || a.event.jobId.localeCompare(b.event.jobId));
  let waitMs: number | undefined = 0;
  for (const running of jobs.filter((job) => job.event.state !== "queued")) {
    const left = remainingMs(running, typical.get(running) ?? {}, now);
    waitMs = waitMs === undefined || left === undefined ? undefined : Math.max(waitMs, left);
  }
  for (const job of queued) {
    if (waitMs === undefined) break;
    starts.set(job, now + waitMs);
    const own = remainingMs(job, typical.get(job) ?? {}, now);
    waitMs = own === undefined ? undefined : waitMs + own;
  }
  return starts;
}

export function estimateActive(
  jobs: ActiveJob[],
  lookup: TypicalLookup,
  now: number,
): Map<ActiveJob, JobEstimate> {
  const typical = new Map(jobs.map((job) => [job, lookup(job)] as const));
  const byPrinter = Map.groupBy(jobs, (job) => job.printerId);
  const estimates = new Map<ActiveJob, JobEstimate>();
  for (const group of byPrinter.values()) {
    const starts = startTimes(group, typical, now);
    for (const job of group) {
      const estimate: JobEstimate = {};
      const typicalMs = typical.get(job) ?? {};
      if (Object.keys(typicalMs).length > 0) estimate.typicalMs = typicalMs;
      const startsAt = starts.get(job);
      if (startsAt !== undefined) estimate.startsAt = startsAt;
      if (Object.keys(estimate).length > 0) estimates.set(job, estimate);
    }
  }
  return estimates;
}

export function withEstimates(
  jobs: ActiveJob[],
  lookup: TypicalLookup,
  now: number,
): (JobStatusEvent & { estimate?: JobEstimate })[] {
  const estimates = estimateActive(jobs, lookup, now);
  return jobs.map((job) => {
    const estimate = estimates.get(job);
    return estimate ? { ...job.event, estimate } : job.event;
  });
}
