import { fetchJobHistoryEntry } from "$lib/api";
import type { PageLoad } from "./$types";

// Client-rendered like the rest of the app (cookies + fetch run in the browser).
export const ssr = false;

export const load: PageLoad = async ({ params, fetch }) => {
  // fetchJobHistoryEntry returns null for 404 specifically and throws on anything
  // else, so a missing job renders the not-found state while a real server failure
  // still surfaces as an error instead of masquerading as "no such job".
  const job = await fetchJobHistoryEntry(params.jobId, fetch);
  return { jobId: params.jobId, job };
};
