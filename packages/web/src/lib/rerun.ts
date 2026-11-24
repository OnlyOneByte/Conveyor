/**
 * "Run again" handoff. The job-detail page stashes a prior job's request here and
 * navigates to `/?rerun=1`; the home page reads it once on mount to pre-fill the
 * submit form. sessionStorage (not a query string) because generator params are
 * arbitrary JSON that would be fragile and size-limited in a URL — and it is scoped
 * to the tab, so it never leaks a stale prefill into an unrelated later visit.
 */
import type { JobState } from "@conveyor/shared";

const KEY = "conveyor.rerun";

export interface RerunPayload {
  generatorId: string;
  params?: unknown;
  printerId: string;
  profileId: string;
  retryOf?: string;
}

interface Rerunnable {
  state: JobState;
  request: { generator: { id: string; params?: unknown }; printerId: string; profileId: string };
}

export const linkedRetry = (handoff: RerunPayload | null, source: string, generatorId: string | undefined) =>
  handoff?.retryOf && source === "generate" && generatorId === handoff.generatorId ? handoff.retryOf : undefined;

export const submitError = (message: string) =>
  message.startsWith("retryOf:") && message.endsWith("already being retried") ? "This failure was already retried." : message;

export function rerunRequest({ state, request }: Rerunnable): Rerunnable["request"] | null {
  const settled = state === "done" || state === "canceled";
  return settled && request.generator.id !== "passthrough" && request.printerId && request.profileId ? request : null;
}

/** Stash a job's request for the home page to pick up. Best-effort. */
export function stashRerun(p: RerunPayload): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable (private mode / quota) — the button just won't pre-fill */
  }
}

/**
 * Read and CLEAR a stashed rerun payload (single-use, so a refresh of the home page
 * doesn't silently re-apply it). Returns null when there is nothing to apply.
 */
export function takeRerun(): RerunPayload | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as RerunPayload;
  } catch {
    return null;
  }
}
