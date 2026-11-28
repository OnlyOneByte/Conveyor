import { redirect } from "@sveltejs/kit";
import {
  fetchCatalogPrinters,
  fetchCatalogProfiles,
  fetchCatalogTransports,
  fetchGenerators,
  signedIn,
} from "#lib/api.js";
import { loadViewportCanvas } from "#lib/components/viewport-canvas.js";
import { EMPTY_CATALOG } from "#lib/make.js";
import { loadMakeParts } from "#lib/make-parts.js";
import { makeShown } from "#lib/make-shown.js";
import type { PageLoad } from "./$types";

export const ssr = false;

export const load: PageLoad = async ({ fetch, url, parent }) => {
  const job = url.searchParams.get("job");
  if (job && !makeShown()) redirect(307, `/jobs/${encodeURIComponent(job)}`);
  const parts = loadMakeParts();
  if (!signedIn((await parent()).auth)) {
    return { catalog: parts.then((p) => ({ ...EMPTY_CATALOG, parts: p })) };
  }
  void loadViewportCanvas();
  const catalog = Promise.all([
    fetchGenerators(fetch).catch(() => []),
    fetchCatalogPrinters(fetch).then(
      (list) => ({ list, failed: false }),
      () => ({ list: [], failed: true }),
    ),
    fetchCatalogProfiles(fetch).catch(() => []),
    fetchCatalogTransports(fetch).catch(() => []),
    parts,
  ]).then(([generators, printers, profiles, transports, p]) => ({
    generators,
    printers: printers.list,
    printersFailed: printers.failed,
    profiles,
    transports,
    parts: p,
  }));
  return { catalog };
};
