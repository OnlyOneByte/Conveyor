import type { Politeness } from "./announce";
import { API, type JobHistoryEntry } from "./api";
import { trackJob } from "./belt";
import type { Catalog } from "./catalog";
import { shown, statusError, unreachable } from "./http-error";
import { rerunRequest } from "./rerun";
import { type Retried, retryJob } from "./retry";
import { shortName, type TrackJob } from "./track";

export const ENDS_MS = 10000;

type Request = JobHistoryEntry["request"];

export interface EndsFeed {
  finished(since: number): Promise<number>;
  needsYou(): Promise<JobHistoryEntry[]>;
  entry(id: string): Promise<JobHistoryEntry | null>;
  submit(body: Request): Promise<unknown>;
  retry(failed: JobHistoryEntry): Promise<Retried>;
  dismiss(id: string): Promise<unknown>;
  cancel(id: string): Promise<unknown>;
  catalog(): Promise<Catalog>;
}

interface EndsUi {
  show(finished: number, needs: TrackJob[]): void;
  toast(text: string, action?: { label: string; run: () => void }): void;
  say(text: string, level: Politeness): void;
  pick(request: Request, retryOf: string): void;
  down?(down: boolean): void;
}

export const midnight = (now: Date) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

const asStatus = (job: JobHistoryEntry) => ({
  ...job,
  jobId: job.id,
  generator: job.request.generator,
  printerId: job.request.printerId,
});

export function createEnds(
  feed: EndsFeed,
  ui: EndsUi,
  { now = () => new Date(), toasted = new Set<string>() } = {},
) {
  let failures = new Map<string, JobHistoryEntry>();

  async function refresh(): Promise<boolean> {
    let away = false;
    const missed = (e: unknown) => {
      away ||= unreachable(e);
      return null;
    };
    const [finished, needs, catalog] = await Promise.all([
      feed.finished(midnight(now())).catch(missed),
      feed.needsYou().catch(missed),
      feed.catalog().catch(() => null),
    ]);
    ui.down?.(away);
    if (finished === null || needs === null) return false;
    failures = new Map(needs.map((job) => [job.id, job]));
    ui.show(
      finished,
      needs.map((job) => trackJob(asStatus(job), undefined, catalog)),
    );
    return true;
  }

  const runnable = (job: TrackJob) =>
    job.request ? rerunRequest({ state: "canceled", request: job.request }) : null;

  async function again(job: TrackJob) {
    const entry = await feed.entry(job.id).catch(() => null);
    const request = entry ? rerunRequest(entry) : runnable(job);
    if (!request) throw new Error("can't run again");
    await feed.submit(request);
    ui.say(`${shortName(job.name)} is queued again.`, "polite");
  }

  async function run(job: TrackJob, action: string) {
    const failed = failures.get(job.id);
    if (action === "Cancel") {
      toasted.add(job.id);
      await feed.cancel(job.id).catch((error: unknown) => {
        toasted.delete(job.id);
        throw error;
      });
      ui.toast(
        `${shortName(job.name)} canceled`,
        runnable(job)
          ? { label: "Print again", run: () => void act(job, "Print again") }
          : undefined,
      );
    } else if (action === "Print again") await again(job);
    else if (action === "Pick printer" && failed) {
      const { printerId, generator } = failed.request;
      const printers = (await feed.catalog().catch(() => null))?.printers ?? [];
      const other = printers.find(
        (p) =>
          p.id !== printerId &&
          (!p.allowedGenerators || p.allowedGenerators.includes(generator.id)),
      );
      ui.pick({ ...failed.request, printerId: other?.id ?? "", profileId: "" }, job.id);
    } else if (action === "Retry" && failed) {
      const retried = await feed.retry(failed);
      if (!retried.ok && retried.held) throw new Refused(retried.error);
      if (!retried.ok && retried.status !== 409) throw new Error(retried.error);
      ui.say(
        retried.ok
          ? `Retrying ${shortName(job.name)}.`
          : `${shortName(job.name)} is already being retried.`,
        "polite",
      );
    } else if (action === "Dismiss") await feed.dismiss(job.id);
    else return;
    if (action !== "Cancel" && action !== "Pick printer") await refresh();
  }

  const act = (job: TrackJob, action: string): Promise<void> =>
    run(job, action).catch((e: unknown) => {
      const why = e instanceof Refused ? `: ${shown(e.message)}` : ".";
      ui.say(
        action === "Print again"
          ? `Couldn't print ${shortName(job.name)} again${why}`
          : `Couldn't ${action.toLowerCase()} ${shortName(job.name)}${why}`,
        "assertive",
      );
    });

  return { refresh, act };
}

class Refused extends Error {}

const send = async (path: string, body: unknown = {}) => {
  const init = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
  const r = await fetch(`${API}${path}`, init);
  if (!r.ok) {
    const no = await r.json();
    const held = no?.held === true && typeof no.error === "string";
    throw held ? new Refused(no.error) : statusError(r, `POST ${path}`);
  }
  return r.json();
};

export const http = {
  finished: async (since: number): Promise<number> => {
    const r = await fetch(`${API}/jobs-history/counts?since=${since}`);
    if (!r.ok) throw statusError(r, "GET /jobs-history/counts");
    const counts: unknown = await r.json();
    return typeof counts === "object" &&
      counts !== null &&
      "done" in counts &&
      typeof counts.done === "number"
      ? counts.done
      : 0;
  },
  needsYou: async (): Promise<JobHistoryEntry[]> => {
    const r = await fetch(`${API}/jobs/needs-you`);
    if (!r.ok) throw statusError(r, "GET /jobs/needs-you");
    return r.json();
  },
  submit: (body: Request) => send("/jobs", body),
  retry: (failed: JobHistoryEntry) => retryJob(failed),
  dismiss: (id: string) => send(`/jobs/${encodeURIComponent(id)}/dismiss`),
};
