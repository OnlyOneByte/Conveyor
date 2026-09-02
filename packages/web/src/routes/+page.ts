import { fetchGenerators, fetchCatalogPrinters, fetchCatalogProfiles, fetchCatalogTransports } from "$lib/api";
import type { PageLoad } from "./$types";

// Load the catalog the picker + form need. Runs on the client (SPA-style) so the
// PWA works offline-installed; SSR is disabled below.
export const ssr = false;

export const load: PageLoad = async ({ fetch, url }) => {
  // A job names a printer and a profile, so the picker needs both catalogs plus the
  // transports (their acceptsFlavors is what makes a pair printable or not).
  const [generators, printers, profiles, transports] = await Promise.all([
    fetchGenerators(fetch).catch(() => []),
    fetchCatalogPrinters(fetch).catch(() => []),
    fetchCatalogProfiles(fetch).catch(() => []),
    fetchCatalogTransports(fetch).catch(() => []),
  ]);
  // Deep link from /history's strip: watch a job that is still in flight.
  return { generators, printers, profiles, transports, initialJobId: url.searchParams.get("job") };
};
