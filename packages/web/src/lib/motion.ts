import type { TrackJob } from "./track";

export const BIN_GAP_PX = 24;

export interface Departure {
  job: TrackJob;
  left: number;
}

export function departures(ended: TrackJob[], lefts: Map<string, number>): Departure[] {
  return ended.flatMap((job) => {
    const left = lefts.get(job.id);
    lefts.delete(job.id);
    return left === undefined ? [] : [{ job, left }];
  });
}

export const hopDistance = (left: number, railPx: number) => Math.max(0, railPx - left) + BIN_GAP_PX;
