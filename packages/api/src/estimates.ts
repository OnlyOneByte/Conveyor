import type { JobStatusEvent } from "@conveyor/shared";
import type { StageDurations } from "@conveyor/shared/db";

export interface ActiveJob {
  event: JobStatusEvent;
  printerId: string;
  generatorId: string;
  createdAt: number;
}

export type JobEstimate = { typicalMs?: StageDurations; startsAt?: number };

export interface EstimateInputs {
  typical(job: ActiveJob): StageDurations;
  isHeld(printerId: string): boolean;
}

type Maybe = number | undefined;

const add = (a: Maybe, b: Maybe): Maybe => (a === undefined || b === undefined ? undefined : a + b);
const later = (a: Maybe, b: Maybe): Maybe =>
  a === undefined || b === undefined ? undefined : Math.max(a, b);

function prepMs({ event }: ActiveJob, typical: StageDurations): Maybe {
  if (event.state === "slicing") return typical.slicer;
  return add(typical.generator, typical.slicer);
}

function printerQueue(group: ActiveJob[], typical: Map<ActiveJob, StageDurations>, now: number) {
  const starts = new Map<ActiveJob, number>();
  let printerFree: Maybe = now;
  let prepFree: Maybe = now;
  const onPrinter = (j: ActiveJob) =>
    j.event.state === "printing" || j.event.state === "transferring";
  for (const job of group.filter(onPrinter)) {
    const { state, at, print } = job.event;
    const left = print?.secondsLeft;
    const end =
      state === "printing"
        ? left === undefined
          ? undefined
          : at + left * 1000
        : add(now, typical.get(job)?.transport);
    printerFree = later(printerFree, end);
  }
  for (const job of group.filter((j) => j.event.state !== "queued" && !onPrinter(j))) {
    const t = typical.get(job) ?? {};
    const start = later(printerFree, add(now, prepMs(job, t)));
    printerFree = add(start, t.transport);
    prepFree = start;
  }
  const queued = group
    .filter((job) => job.event.state === "queued")
    .sort((a, b) => a.createdAt - b.createdAt || a.event.jobId.localeCompare(b.event.jobId));
  for (const job of queued) {
    const t = typical.get(job) ?? {};
    const prepDone = add(prepFree, prepMs(job, t));
    const start = later(printerFree, prepDone);
    if (start === undefined) break;
    starts.set(job, start);
    prepFree = start;
    printerFree = add(start, t.transport);
  }
  return starts;
}

export function withEstimates(
  jobs: ActiveJob[],
  inputs: EstimateInputs,
  now: number,
): (JobStatusEvent & { estimate?: JobEstimate })[] {
  const pairOf = (job: ActiveJob) => JSON.stringify([job.generatorId, job.printerId]);
  const byPair = new Map<string, StageDurations>();
  for (const job of jobs)
    if (!byPair.has(pairOf(job))) byPair.set(pairOf(job), inputs.typical(job));
  const typical = new Map(jobs.map((job) => [job, byPair.get(pairOf(job)) ?? {}] as const));
  const starts = new Map<ActiveJob, number>();
  for (const [printerId, group] of Map.groupBy(jobs, (job) => job.printerId)) {
    if (inputs.isHeld(printerId)) continue;
    for (const [job, start] of printerQueue(group, typical, now)) starts.set(job, start);
  }
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
