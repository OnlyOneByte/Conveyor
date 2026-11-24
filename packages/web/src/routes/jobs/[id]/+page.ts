import {
  fetchCatalogPrinters,
  fetchCatalogProfiles,
  fetchGenerators,
  fetchJobHistoryEntry,
  fetchJobSnapshot,
  signedIn,
} from "#lib/api.js";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, fetch, parent }) => {
  const empty = { job: null, live: false, generator: null, printer: "", profile: "" };
  if (!signedIn((await parent()).auth)) return empty;
  const [job, generators, printers, profiles] = await Promise.all([
    fetchJobHistoryEntry(params.id, fetch),
    fetchGenerators(fetch).catch(() => []),
    fetchCatalogPrinters(fetch).catch(() => []),
    fetchCatalogProfiles(fetch).catch(() => []),
  ]);
  if (!job) {
    const live = (await fetchJobSnapshot(params.id).catch(() => null)) !== null;
    return { ...empty, live };
  }
  const { generator, printerId, profileId } = job.request;
  return {
    job,
    live: false,
    generator: generators.find((g) => g.id === generator.id) ?? null,
    printer: printers.find((p) => p.id === printerId)?.name ?? printerId,
    profile: profiles.find((p) => p.id === profileId)?.name ?? profileId,
  };
};
