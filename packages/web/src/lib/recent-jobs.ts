import { writable } from "svelte/store";
import type { JobState } from "@conveyor/shared";

/**
 * A small client-side memory of jobs this browser has submitted, persisted to
 * localStorage so a page refresh no longer loses job visibility. The durable
 * job history lives in SQLite, but `/jobs-history` is admin-gated — a regular
 * user's main page can't read it — so the user-facing "recent jobs" strip is
 * backed by localStorage here, refreshed from per-job snapshots (Redis) when
 * available and falling back to the last-known state otherwise.
 */
export interface RecentJob {
  jobId: string;
  stationName: string;
  generatorId: string;
  submittedAt: number;
  /** last-known state; updated as fresh snapshots arrive */
  state: JobState;
}

const KEY = "conveyor.recentJobs";
const MAX = 8;

function load(): RecentJob[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentJob[]) : [];
  } catch {
    return []; // corrupt entry — start clean rather than throw
  }
}

function persist(jobs: RecentJob[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs));
  } catch {
    // quota / private-mode — keep the in-memory store working regardless
  }
}

export const recentJobs = writable<RecentJob[]>(load());

/** Record a freshly-submitted job (most-recent first, capped at {@link MAX}). */
export function rememberJob(entry: RecentJob): void {
  recentJobs.update((jobs) => {
    const next = [entry, ...jobs.filter((j) => j.jobId !== entry.jobId)].slice(0, MAX);
    persist(next);
    return next;
  });
}

/** Patch a job's last-known state (called as snapshots/live events arrive). */
export function updateJobState(jobId: string, state: JobState): void {
  recentJobs.update((jobs) => {
    let changed = false;
    const next = jobs.map((j) => {
      if (j.jobId === jobId && j.state !== state) {
        changed = true;
        return { ...j, state };
      }
      return j;
    });
    if (changed) persist(next);
    return next;
  });
}
