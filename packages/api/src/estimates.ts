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
  for (const job of group.filter((j) => j.event.state !== "queued")) {
    const t = typical.get(job) ?? {};
    const { state, at, print } = job.event;
    if (state === "printing") {
      const left = print?.secondsLeft;
      printerFree = later(printerFree, left === undefined ? undefined : at + left * 1000);
    } else if (state === "transferring") {
      printerFree = later(printerFree, add(now, t.transport));
    } else {
      prepFree = later(prepFree, add(now, prepMs(job, t)));
      printerFree = later(printerFree, add(prepFree, t.transport));
    }
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
    prepFree = prepDone;
    printerFree = add(start, t.transport);
  }
  return starts;
}

export function withEstimates(
  jobs: ActiveJob[],
  inputs: EstimateInputs,
  now: number,
): (JobStatusEvent & { estimate?: JobEstimate })[] {
  const typical = new Map(jobs.map((job) => [job, inputs.typical(job)] as const));
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
