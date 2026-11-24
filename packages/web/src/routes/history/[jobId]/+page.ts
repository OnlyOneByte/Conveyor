import { fetchJobHistoryEntry, signedIn } from "#lib/api.js";
import type { PageLoad } from "./$types";

export const ssr = false;

export const load: PageLoad = async ({ params, fetch, parent }) => {
  if (!signedIn((await parent()).auth)) return { jobId: params.jobId, job: null };
  const job = await fetchJobHistoryEntry(params.jobId, fetch);
  return { jobId: params.jobId, job };
};
