import type { JobState } from "@conveyor/shared";
import { parseStatusEvent } from "@conveyor/shared/status-lite";
import { changes, type News } from "./belt-news";
import type { Catalog } from "./catalog";
import { jobName } from "./job-settings";
import { OFFLINE, onRail, shortName, type TrackJob } from "./track";

export const POLL_MS = 2000;
export const MAX_SOCKETS = 10;
export const FAILS_TO_CLEAR = 2;
export const COVERED_MS = 10_000;

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
  generator?: { id: string; params?: unknown };
  printerId?: string;
  profileId?: string;
}

export interface Feed {
  active(): Promise<Status[]>;
  final(id: string): Promise<Status | null>;
  socket(id: string): Socket;
  catalog(): Promise<Catalog>;
  clock(): string;
}

export const titled = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);
const settled = (job: TrackJob) => job.state === "done" || job.state === "failed" || job.state === "canceled";

export function named(generator: NonNullable<Status["generator"]>, catalog: Catalog | null) {
  const known = catalog?.generators.find((g) => g.id === generator.id);
  return jobName(known?.name ?? titled(generator.id), generator.params, known?.paramSchema ?? null, known?.ui ?? null);
}

export function trackJob(view: Status, was?: TrackJob, catalog: Catalog | null = null): TrackJob {
  const job: TrackJob = { id: view.jobId, name: view.generator && (catalog || !was) ? named(view.generator, catalog) : (was?.name ?? "Job"), state: view.state };
  if (view.progress !== undefined) job.progress = view.progress;
  const printer = catalog?.printers.find((p) => p.id === view.printerId)?.name ?? was?.printer;
  if (printer) job.printer = printer;
  if (view.error) job.reason = view.error.reason;
  const { generator, printerId, profileId } = view;
  const request = generator && printerId && profileId ? { generator, printerId, profileId } : was?.request;
  if (request) job.request = request;
  return job;
}

export function createBelt(feed: Feed, show: (jobs: TrackJob[], ended: TrackJob[], offline: boolean) => void, tell: (news: News[]) => void) {
  let known = new Map<string, TrackJob>();
  const sockets = new Map<string, Socket>();
  let failures = 0;
  let offline = false;
  let asked = 0;
  let applied = 0;

  function settle(next: TrackJob[], extra: News[] = []) {
    tell([...changes(known, next, feed.clock()), ...extra]);
    const ended = next.filter(settled);
    known = new Map(next.filter((job) => !settled(job)).map((job) => [job.id, job]));
    show([...known.values()], ended, offline);
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
      applied = ++asked;
      settle([...known.values()].map((job) => (job.id === id ? trackJob(event, job) : job)));
    };
    socket.onclose = () => {
      if (sockets.get(id) === socket) sockets.delete(id);
    };
    sockets.set(id, socket);
  }

  async function poll() {
    const mine = ++asked;
    const live = await feed.active().catch(() => null);
    if (mine < applied) return;
    if (!live) {
      if (++failures < FAILS_TO_CLEAR || offline) return;
      offline = true;
      stop();
      show([...known.values()], [], true);
      tell([{ level: "polite", text: `${OFFLINE}. The belt shows the last jobs it saw` }]);
      return;
    }
    failures = 0;
    if (offline) tell([{ level: "polite", text: "Conveyor is back" }]);
    offline = false;
    const catalog = await feed.catalog().catch(() => null);
    const seen = new Set(live.map((view) => view.jobId));
    const gone = [...known.values()].filter((job) => !seen.has(job.id));
    const lost: News[] = [];
    const ends = await Promise.all(gone.map(async (job) => {
      const event = await feed.final(job.id).catch(() => {
        lost.push({ level: "polite", text: `${shortName(job.name)} left the belt; its job page has how it ended`, ended: job.id });
        return null;
      });
      return event ? [trackJob(event, job)] : [];
    }));
    const fresh = (view: Status, was?: TrackJob) => {
      const job = trackJob(view, was, catalog);
      return was && sockets.has(view.jobId) ? { ...was, name: job.name, ...(job.printer ? { printer: job.printer } : {}) } : job;
    };
    if (mine < applied) return;
    applied = mine;
    settle([...live.map((view) => fresh(view, known.get(view.jobId))), ...ends.flat()], lost);
  }

  function stop() {
    for (const socket of sockets.values()) socket.close();
    sockets.clear();
  }

  const covered = () => known.size > 0 && [...known.values()].every((job) => onRail(job.state) && sockets.has(job.id));

  return { poll, stop, covered };
}

export function createTicker(belt: { poll(): Promise<void>; covered(): boolean }, ready: () => boolean, now = () => Date.now()) {
  let polling = false;
  let again = false;
  let last = Number.NEGATIVE_INFINITY;
  const run = () => {
    polling = true;
    last = now();
    void belt.poll().finally(() => {
      polling = false;
      if (again && ready()) run();
      again = false;
    });
  };
  const tick = () => {
    if (polling || !ready() || (belt.covered() && now() - last < COVERED_MS)) return;
    run();
  };
  const force = () => {
    if (polling) again = true;
    else if (ready()) run();
  };
  return Object.assign(tick, { force });
}

const JOB_SENT = "conveyor:job-sent";

export const jobSent = () => dispatchEvent(new Event(JOB_SENT));

export function onJobSent(run: () => void): () => void {
  addEventListener(JOB_SENT, run);
  return () => removeEventListener(JOB_SENT, run);
}
