import type { JobState } from "@conveyor/shared";

export type RailState = "generating" | "slicing" | "transferring" | "printing";

export const SPANS: Record<RailState, readonly [number, number]> = {
  generating: [0, 0.15],
  slicing: [0.15, 0.34],
  transferring: [0.34, 0.49],
  printing: [0.49, 1],
};

export const STAGE_LABELS: Record<RailState, string> = {
  generating: "Model",
  slicing: "Slice",
  transferring: "Send",
  printing: "Print",
};

export const INSET = 0.02;
export const COLLAPSE_AT = 80;
export const REOPEN_AT = 4;

export const collapsedBelt = (path: string, scrollY: number, opened: boolean, was = false) =>
  !opened && (path !== "/" || scrollY > (was ? REOPEN_AT : COLLAPSE_AT));
export const JOIN_PX = 6;
export const SPLIT_PX = 16;
export const MIN_CHIP_PX = 156;

export const onRail = (state: JobState): state is RailState => state in SPANS;

export function centre(state: RailState, progress: number): number {
  const [start, end] = SPANS[state];
  const p = Math.min(1, Math.max(0, progress));
  return start + INSET + p * (end - start - 2 * INSET);
}

export interface Placed {
  id: string;
  x: number;
  width: number;
}

export interface Group {
  ids: string[];
  x: number;
  width: number;
}

const widest = (members: Placed[]) => Math.max(...members.map((m) => m.width));
const clamp = (x: number, width: number, railPx: number) => Math.min(Math.max(x, width / 2), Math.max(width / 2, railPx - width / 2));

export function merge(chips: Placed[], railPx: number, previous: Group[] = [], groupWidth = widest): Group[] {
  const together = new Set(previous.flatMap((g) => g.ids.slice(1).map((id, i) => `${g.ids[i]} ${id}`)));
  const groups: { members: Placed[]; x: number; width: number }[] = [];
  for (const chip of chips.map((c) => ({ ...c, x: clamp(c.x, c.width, railPx) })).sort((a, b) => a.x - b.x)) {
    const last = groups.at(-1);
    const prior = last?.members.at(-1);
    const gap = last ? chip.x - chip.width / 2 - (last.x + last.width / 2) : Number.POSITIVE_INFINITY;
    const stays = prior !== undefined && together.has(`${prior.id} ${chip.id}`) && gap <= SPLIT_PX;
    if (last && (gap < JOIN_PX || stays)) {
      last.members.push(chip);
      last.x = last.members.reduce((sum, m) => sum + m.x, 0) / last.members.length;
      last.width = groupWidth(last.members);
    } else groups.push({ members: [chip], x: chip.x, width: chip.width });
    while (groups.length > 1) {
      const [a, b] = groups.slice(-2);
      if (!a || !b || b.x - b.width / 2 - (a.x + a.width / 2) >= JOIN_PX) break;
      const members = [...a.members, ...b.members];
      groups.splice(-2, 2, { members, x: members.reduce((sum, m) => sum + m.x, 0) / members.length, width: groupWidth(members) });
    }
  }
  return groups.map(({ members, x, width }) => ({
    ids: members.map((m) => m.id),
    x: clamp(x, width, railPx),
    width,
  }));
}

export const shortName = (name: string) => {
  const rest = name.replace(/^gridfinity\s+/i, "");
  return rest === name ? name : rest.charAt(0).toUpperCase() + rest.slice(1);
};

const WORDS: Record<JobState, string> = {
  queued: "queued",
  generating: "modelling",
  slicing: "slicing",
  transferring: "sending",
  printing: "printing",
  done: "done",
  failed: "failed",
  canceled: "canceled",
};

export interface TrackJob {
  id: string;
  name: string;
  state: JobState;
  progress?: number;
  printer?: string;
  reason?: string;
  request?: { generator: { id: string; params?: unknown }; printerId: string; profileId: string };
}

export function value({ state, progress }: TrackJob): string {
  if (state === "queued") return "next";
  if (state === "generating") return "…";
  if (state === "done") return "✓";
  if (state === "failed") return "!";
  if (state === "canceled") return "×";
  return `${Math.round((progress ?? 0) * 100)}%`;
}

export const ACTIONS: Partial<Record<JobState, string>> = {
  queued: "Cancel",
  generating: "Cancel",
  slicing: "Cancel",
  transferring: "Cancel",
  printing: "Cancel",
  failed: "Retry",
  canceled: "Print again",
};

export const status = (job: TrackJob) => `${WORDS[job.state]}${job.printer ? ` on ${job.printer}` : ""}`;

export const visible = (job: TrackJob) => `${shortName(job.name)} ${value(job)}`;

export const chipName = (job: TrackJob) =>
  `${visible(job)}, ${job.name}${job.printer ? ` on ${job.printer}` : ""}, ${WORDS[job.state]}`;

export const groupVisible = (jobs: TrackJob[]) => `${jobs.length} jobs ${jobs.map(value).join(" · ")}`;

export const groupName = (jobs: TrackJob[]) =>
  `${groupVisible(jobs)}: ${jobs.map((j) => `${shortName(j.name)}, ${WORDS[j.state]}`).join("; ")}`;
