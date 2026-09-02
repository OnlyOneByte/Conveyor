import { fetchGenerators, fetchStations } from "$lib/api";
import type { PageLoad } from "./$types";

// Load the catalog the picker + form need. Runs on the client (SPA-style) so the
// PWA works offline-installed; SSR is disabled below.
export const ssr = false;

export const load: PageLoad = async ({ fetch, url }) => {
  const [generators, stations] = await Promise.all([
    fetchGenerators(fetch).catch(() => []),
    fetchStations(fetch).catch(() => []),
  ]);
  // Deep link from /history's strip: watch a job that is still in flight.
  return { generators, stations, initialJobId: url.searchParams.get("job") };
};
