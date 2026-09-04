/**
 * "Run again" handoff. The job-detail page stashes a prior job's request here and
 * navigates to `/?rerun=1`; the home page reads it once on mount to pre-fill the
 * submit form. sessionStorage (not a query string) because generator params are
 * arbitrary JSON that would be fragile and size-limited in a URL — and it is scoped
 * to the tab, so it never leaks a stale prefill into an unrelated later visit.
 */
const KEY = "conveyor.rerun";

export interface RerunPayload {
  generatorId: string;
  params?: unknown;
  printerId: string;
  profileId: string;
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
