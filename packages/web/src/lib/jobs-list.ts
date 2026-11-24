import type { JobState, JobView } from "@conveyor/shared";
import { ago } from "./ago";
import type { Politeness } from "./announce";
import { API, cancelJob, type JobHistoryEntry } from "./api";
import { named } from "./belt";
import { midnight } from "./belt-ends";
import type { Catalog } from "./catalog";
import { failureText } from "./job-failure";
import { duration } from "./job-settings";
import { retryJob } from "./retry";
import { shortName } from "./track";

export type Filter = "all" | "live" | "done" | "failed" | "canceled";
export type Settled = Exclude<Filter, "all" | "live">;
export type Counts = Record<Settled, number>;

export const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "On the belt" },
  { id: "done", label: "Printed" },
  { id: "failed", label: "Failed" },
  { id: "canceled", label: "Canceled" },
];

export const PAGE = 50;
export const DAY_MS = 86_400_000;

export interface Row {
  id: string;
  name: string;
  state: JobState;
  progress: number;
  printer: string | undefined;
  status: string;
  why: string | undefined;
  time: string;
  at: number;
  request: JobHistoryEntry["request"] | undefined;
}

export interface Group {
  title: string;
  rows: Row[];
}

const LIVE: Partial<Record<JobState, string>> = {
  queued: "waiting",
  generating: "building the model",
  slicing: "slicing",
  transferring: "sending",
  printing: "printing",
};

const STAGES: Record<string, string> = { generator: "Model", slicer: "Slice", transport: "Send", print: "Print" };

const percent = (progress: number | undefined) => `${Math.round((progress ?? 0) * 100)}%`;
const printerName = (id: string | undefined, catalog: Catalog | null) => catalog?.printers.find((p) => p.id === id)?.name;

export function liveRow(view: JobView, catalog: Catalog | null, now: number): Row {
  const words = LIVE[view.state] ?? view.state;
  const measured = view.state === "slicing" || view.state === "transferring" || view.state === "printing";
  const at = view.createdAt ?? view.at;
  const request = view.generator && view.printerId && view.profileId ? { generator: view.generator, printerId: view.printerId, profileId: view.profileId } : undefined;
  return {
    id: view.jobId,
    name: view.generator ? named(view.generator, catalog) : "Job",
    state: view.state,
    progress: view.progress ?? 0,
    printer: printerName(view.printerId, catalog),
    status: measured ? `${words}, ${percent(view.progress)}` : words,
    why: undefined,
    time: `added ${ago(at, now)}`,
    at,
    request,
  };
}

export function settledRow(entry: JobHistoryEntry, catalog: Catalog | null, now: number): Row {
  const stage = entry.error?.stage ?? entry.stage ?? "";
  const status =
    entry.state === "done"
      ? `printed in ${duration(entry.timings?.reduce((sum, t) => sum + (t.durationMs ?? 0), 0) || entry.updatedAt - entry.createdAt)}`
      : entry.state === "failed"
        ? `failed at ${STAGES[stage] ?? "a step"}`
        : "canceled";
  return {
    id: entry.id,
    name: named(entry.request.generator, catalog),
    state: entry.state,
    progress: 1,
    printer: printerName(entry.request.printerId, catalog),
    status,
    why: entry.state === "failed" && entry.error ? failureText(entry.error.stage, entry.error.reason).detail : undefined,
    time: ago(entry.updatedAt, now),
    at: entry.updatedAt,
    request: entry.request,
  };
}

export function groupRows(live: Row[], settled: Row[], now: Date): Group[] {
  const today = midnight(now);
  const onBelt = new Set(live.map((row) => row.id));
  const done = settled.filter((row) => !onBelt.has(row.id));
  const day = (title: string, from: number, to: number) => ({ title, rows: done.filter((row) => row.at >= from && row.at < to) });
  return [
    { title: "On the belt", rows: live },
    day("Today", today, Number.POSITIVE_INFINITY),
    day("Yesterday", today - DAY_MS, today),
    day("Earlier", Number.NEGATIVE_INFINITY, today - DAY_MS),
  ].filter((group) => group.rows.length > 0);
}

export function pillCount(filter: Filter, live: number, counts: Counts | null): number | null {
  if (filter === "live") return live;
  if (!counts) return null;
  return filter === "all" ? live + counts.done + counts.failed + counts.canceled : counts[filter];
}

export function mergeSettled(older: Row[], fresh: Row[]): Row[] {
  const seen = new Set(fresh.map((row) => row.id));
  return [...fresh, ...older.filter((row) => !seen.has(row.id))].sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
}

export function historyPath(filter: Filter, after: Row | undefined): string {
  const query = new URLSearchParams({ limit: String(PAGE) });
  if (filter !== "all" && filter !== "live") query.set("state", filter);
  if (after) query.set("before", `${after.at}:${after.id}`);
  return `${API}/jobs-history?${query}`;
}

async function getJson<T>(path: string, fetchFn: typeof fetch): Promise<T> {
  const r = await fetchFn(path);
  if (!r.ok) throw new Error(`GET ${path} ${r.status}`);
  return r.json();
}

export const fetchPage = (filter: Filter, after: Row | undefined, fetchFn: typeof fetch = fetch) =>
  getJson<JobHistoryEntry[]>(historyPath(filter, after), fetchFn);
export const fetchCounts = (fetchFn: typeof fetch = fetch) => getJson<Counts>(`${API}/jobs-history/counts`, fetchFn);

export const EMPTY: Record<Filter, string> = {
  all: "No jobs yet",
  live: "Nothing on the belt",
  done: "Nothing printed yet",
  failed: "No failed jobs",
  canceled: "No canceled jobs",
};

export const canCancel = (row: Row) => row.state in LIVE;

export type Said = [string, Politeness];

export async function retryRow(row: Row | undefined, send = retryJob): Promise<Said> {
  if (!row || row.state !== "failed" || !row.request) return ["Only a failed job can be retried.", "polite"];
  const name = shortName(row.name);
  const done = await send({ id: row.id, request: row.request }).catch(() => null);
  if (done?.ok) return [`Retrying ${name}.`, "polite"];
  return [done?.status === 409 ? `${name} is already being retried.` : `Couldn't retry ${name}.`, "assertive"];
}

export const cancelRow = (row: Row, send = cancelJob): Promise<Said> =>
  send(row.id).then(
    (): Said => [`${shortName(row.name)} canceled.`, "polite"],
    (): Said => [`Couldn't cancel ${shortName(row.name)}. Try again.`, "assertive"],
  );
