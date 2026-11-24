import { type JobState, parseStatusEvent } from "@conveyor/shared";
import { changes, type News } from "./belt-news";
import { onRail, type TrackJob } from "./track";

export const POLL_MS = 2000;
export const MAX_SOCKETS = 10;

export interface Socket {
  onmessage: ((message: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  close(): void;
}

export interface Status {
  jobId: string;
  state: JobState;
  progress?: number;
  error?: { reason: string };
  generator?: { id: string };
  printerId?: string;
}

export interface Feed {
  active(): Promise<Status[]>;
  final(id: string): Promise<Status | null>;
  socket(id: string): Socket;
  clock(): string;
}

const titled = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);
const settled = (job: TrackJob) => job.state === "done" || job.state === "failed" || job.state === "canceled";

export function trackJob(view: Status, was?: TrackJob): TrackJob {
  const job: TrackJob = { id: view.jobId, name: view.generator ? titled(view.generator.id) : (was?.name ?? "Job"), state: view.state };
  if (view.progress !== undefined) job.progress = view.progress;
  const printer = view.printerId ?? was?.printer;
  if (printer) job.printer = printer;
  if (view.error) job.reason = view.error.reason;
  return job;
}

export function createBelt(feed: Feed, show: (jobs: TrackJob[]) => void, tell: (news: News[]) => void) {
  let known = new Map<string, TrackJob>();
  const sockets = new Map<string, Socket>();

  function settle(next: TrackJob[]) {
    tell(changes(known, next, feed.clock()));
    known = new Map(next.filter((job) => !settled(job)).map((job) => [job.id, job]));
    show([...known.values()]);
    for (const [id, socket] of sockets) {
      const job = known.get(id);
      if (job && onRail(job.state)) continue;
      socket.close();
      sockets.delete(id);
    }
    for (const job of known.values()) {
      if (sockets.size >= MAX_SOCKETS) break;
      if (onRail(job.state) && !sockets.has(job.id)) listen(job.id);
    }
  }

  function listen(id: string) {
    const socket = feed.socket(id);
    socket.onmessage = (message) => {
      const event = typeof message.data === "string" ? parseStatusEvent(message.data) : undefined;
      if (event?.jobId !== id || !known.has(id)) return;
      settle([...known.values()].map((job) => (job.id === id ? trackJob(event, job) : job)));
    };
    socket.onclose = () => {
      if (sockets.get(id) === socket) sockets.delete(id);
    };
    sockets.set(id, socket);
  }

  async function poll() {
    const live = await feed.active();
    const seen = new Set(live.map((view) => view.jobId));
    const gone = [...known.values()].filter((job) => !seen.has(job.id));
    const ends = await Promise.all(gone.map(async (job) => {
      const event = await feed.final(job.id).catch(() => null);
      return event ? [trackJob(event, job)] : [];
    }));
    const kept = (view: Status) => (sockets.has(view.jobId) ? known.get(view.jobId) : undefined);
    settle([...live.map((view) => kept(view) ?? trackJob(view, known.get(view.jobId))), ...ends.flat()]);
  }

  function stop() {
    for (const socket of sockets.values()) socket.close();
    sockets.clear();
  }

  return { poll, stop };
}
