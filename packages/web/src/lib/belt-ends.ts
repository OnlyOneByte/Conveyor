import type { Politeness } from "./announce";
import { API, type JobHistoryEntry } from "./api";
import { trackJob } from "./belt";
import type { Catalog } from "./catalog";
import { shortName, type TrackJob } from "./track";

export const ENDS_MS = 10000;

type Request = JobHistoryEntry["request"];

export interface EndsFeed {
  history(): Promise<JobHistoryEntry[]>;
  needsYou(): Promise<JobHistoryEntry[]>;
  entry(id: string): Promise<JobHistoryEntry | null>;
  submit(body: Request & { retryOf?: string }): Promise<unknown>;
  dismiss(id: string): Promise<unknown>;
  cancel(id: string): Promise<unknown>;
  catalog(): Promise<Catalog>;
}

export interface EndsUi {
  show(finished: number, needs: TrackJob[]): void;
  toast(text: string, action: { label: string; run: () => void }): void;
  say(text: string, level: Politeness): void;
  pick(request: Request): void;
}

const sameDay = (at: number, now: Date) => new Date(at).toDateString() === now.toDateString();

export const finishedToday = (history: JobHistoryEntry[], now: Date) =>
  history.filter((job) => job.state === "done" && sameDay(job.updatedAt, now)).length;

const asStatus = (job: JobHistoryEntry) => ({ ...job, jobId: job.id, generator: job.request.generator, printerId: job.request.printerId });

export function createEnds(feed: EndsFeed, ui: EndsUi, now = () => new Date()) {
  let failures = new Map<string, JobHistoryEntry>();

  async function refresh() {
    const [history, needs, catalog] = await Promise.all([feed.history(), feed.needsYou(), feed.catalog().catch(() => null)]);
    failures = new Map(needs.map((job) => [job.id, job]));
    ui.show(finishedToday(history, now()), needs.map((job) => trackJob(asStatus(job), undefined, catalog)));
  }

  async function again(job: TrackJob) {
    const entry = await feed.entry(job.id);
    if (!entry) throw new Error("gone");
    await feed.submit(entry.request);
    ui.say(`${shortName(job.name)} is queued again.`, "polite");
  }

  async function run(job: TrackJob, action: string) {
    const failed = failures.get(job.id);
    if (action === "Cancel") {
      await feed.cancel(job.id);
      ui.toast(`${shortName(job.name)} canceled`, { label: "Print again", run: () => void act(job, "Print again") });
    } else if (action === "Print again") await again(job);
    else if (action === "Pick printer" && failed) ui.pick({ ...failed.request, printerId: "", profileId: "" });
    else if (action === "Retry" && failed) {
      await feed.submit({ ...failed.request, retryOf: job.id });
      ui.say(`Retrying ${shortName(job.name)}.`, "polite");
    } else if (action === "Dismiss") await feed.dismiss(job.id);
    else return;
    if (action !== "Cancel" && action !== "Pick printer") await refresh().catch(() => {});
  }

  const act = (job: TrackJob, action: string): Promise<void> =>
    run(job, action).catch(() => ui.say(action === "Print again" ? `Couldn't print ${shortName(job.name)} again.` : `Couldn't ${action.toLowerCase()} ${shortName(job.name)}.`, "assertive"));

  return { refresh, act };
}

const send = async (path: string, body?: unknown) => {
  const init = body === undefined ? { method: "POST" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch(`${API}${path}`, init);
  if (!r.ok) throw new Error(`POST ${path} ${r.status}`);
  return r.json();
};

export const http = {
  needsYou: async (): Promise<JobHistoryEntry[]> => {
    const r = await fetch(`${API}/jobs/needs-you`);
    if (!r.ok) throw new Error(`GET /jobs/needs-you ${r.status}`);
    return r.json();
  },
  submit: (body: Request & { retryOf?: string }) => send("/jobs", body),
  dismiss: (id: string) => send(`/jobs/${encodeURIComponent(id)}/dismiss`),
};
