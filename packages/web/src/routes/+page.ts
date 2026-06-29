import { fetchGenerators, fetchStations } from "$lib/api";
import type { PageLoad } from "./$types";

// Load the catalog the picker + form need. Runs on the client (SPA-style) so the
// PWA works offline-installed; SSR is disabled below.
export const ssr = false;

export const load: PageLoad = async ({ fetch }) => {
  const [generators, stations] = await Promise.all([
    fetchGenerators(fetch).catch(() => []),
    fetchStations(fetch).catch(() => []),
  ]);
  return { generators, stations };
};
