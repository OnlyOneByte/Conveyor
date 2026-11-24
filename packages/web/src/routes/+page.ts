import {
  fetchCatalogPrinters,
  fetchCatalogProfiles,
  fetchCatalogTransports,
  fetchGenerators,
  signedIn,
} from "#lib/api.js";
import { makeShown } from "#lib/make-shown.js";
import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

export const ssr = false;

export const load: PageLoad = async ({ fetch, url, parent }) => {
  const initialJobId = url.searchParams.get("job");
  if (initialJobId && !makeShown()) redirect(307, `/jobs/${encodeURIComponent(initialJobId)}`);
  if (!signedIn((await parent()).auth))
    return { generators: [], printers: [], profiles: [], transports: [], initialJobId };
  const [generators, printers, profiles, transports] = await Promise.all([
    fetchGenerators(fetch).catch(() => []),
    fetchCatalogPrinters(fetch).catch(() => []),
    fetchCatalogProfiles(fetch).catch(() => []),
    fetchCatalogTransports(fetch).catch(() => []),
  ]);
  return { generators, printers, profiles, transports, initialJobId };
};
