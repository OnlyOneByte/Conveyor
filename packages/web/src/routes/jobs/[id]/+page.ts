import {
  fetchActiveJobs,
  fetchCatalogPrinters,
  fetchCatalogProfiles,
  fetchGenerators,
  fetchJobHistoryEntry,
  signedIn,
} from "#lib/api.js";
import { liveView, placeInLine, SETTLED } from "#lib/job-live.js";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, fetch, parent }) => {
  const empty = { job: null, view: null, place: null, generator: null, printer: "", profile: "" };
  if (!signedIn((await parent()).auth)) return empty;
  const [job, generators, printers, profiles] = await Promise.all([
    fetchJobHistoryEntry(params.id, fetch),
    fetchGenerators(fetch).catch(() => []),
    fetchCatalogPrinters(fetch).catch(() => []),
    fetchCatalogProfiles(fetch).catch(() => []),
  ]);
  const settled = job && SETTLED.includes(job.state) ? job : null;
  const view = settled ? null : await liveView(params.id, fetch);
  if (!settled && !view) return empty;
  const generatorId = settled?.request.generator.id ?? view?.generator?.id;
  const printerId = settled?.request.printerId ?? view?.printerId ?? "";
  const profileId = settled?.request.profileId ?? view?.profileId ?? "";
  const active = view?.state === "queued" ? await fetchActiveJobs(fetch).catch(() => []) : [];
  return {
    job: settled,
    view,
    place: placeInLine(params.id, active),
    generator: generators.find((g) => g.id === generatorId) ?? null,
    printer: printers.find((p) => p.id === printerId)?.name ?? printerId,
    profile: profiles.find((p) => p.id === profileId)?.name ?? profileId,
  };
};
