import type { Politeness } from "./announce";
import { onRail, STAGE_LABELS, shortName, type TrackJob } from "./track";

export interface News {
  level: Politeness;
  text: string;
  canceled?: string;
}

export const BURST_MS = 2000;

const on = (job: TrackJob) => (job.printer ? ` on ${job.printer}` : "");

export function changes(before: ReadonlyMap<string, TrackJob>, after: TrackJob[], time: string): News[] {
  return after.flatMap((job): News[] => {
    const was = before.get(job.id);
    if (!was || was.state === job.state) return [];
    const name = shortName(job.name);
    if (job.state === "failed") return [{ level: "assertive", text: `${name} failed${job.reason ? `: ${job.reason.replace(/[.!?\s]+$/, "")}` : ""}` }];
    if (job.state === "done") return [{ level: "polite", text: `${name} finished${on(job)}` }];
    if (job.state === "canceled") return [{ level: "polite", text: `${name} was canceled`, canceled: job.id }];
    if (job.state === "printing") return [{ level: "polite", text: `${name} started printing${on(job)} at ${time}` }];
    if (onRail(job.state)) return [{ level: "polite", text: `${name} moved to ${STAGE_LABELS[job.state]}${on(job)}` }];
    return [];
  });
}

const ENDINGS: Record<Politeness, string> = { polite: ".", assertive: ". Retry is on the job." };

export function createNewsDesk(say: (text: string, level: Politeness) => void, after: (run: () => void, ms: number) => unknown = setTimeout, toasted: Set<string> = new Set()) {
  const waiting: Record<Politeness, string[]> = { polite: [], assertive: [] };
  return (news: News[]) => {
    for (const { level, text, canceled } of news) {
      if (canceled && toasted.delete(canceled)) continue;
      if (waiting[level].push(text) > 1) continue;
      after(() => say(`${waiting[level].splice(0).join("; ")}${ENDINGS[level]}`, level), BURST_MS);
    }
  };
}
