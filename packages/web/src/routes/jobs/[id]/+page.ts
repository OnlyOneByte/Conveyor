import {
  fetchCatalogPrinters,
  fetchCatalogProfiles,
  fetchGenerators,
  fetchJobHistoryEntry,
  signedIn,
} from "#lib/api.js";
import { liveView, SETTLED } from "#lib/job-live.js";
import type { PageLoad } from "./$types";

const empty = { job: null, view: null, generator: null, printer: "", profile: "" };

export type JobPageData = Awaited<ReturnType<typeof page>>;

export const load: PageLoad = async ({ params, fetch, parent }) =>
  signedIn((await parent()).auth)
    ? { page: page(params.id, fetch) }
    : { page: Promise.resolve(empty) };

async function page(id: string, fetch: typeof globalThis.fetch) {
  const [job, generators, printers, profiles] = await Promise.all([
    fetchJobHistoryEntry(id, fetch),
    fetchGenerators(fetch).catch(() => []),
    fetchCatalogPrinters(fetch).catch(() => []),
    fetchCatalogProfiles(fetch).catch(() => []),
  ]);
  const settled = job && SETTLED.includes(job.state) ? job : null;
  const view = settled ? null : await liveView(id, fetch);
  if (!settled && !view) return empty;
  const generatorId = settled?.request.generator.id ?? view?.generator?.id;
  const printerId = settled?.request.printerId ?? view?.printerId ?? "";
  const profileId = settled?.request.profileId ?? view?.profileId ?? "";
  return {
    job: settled,
    view,
    generator: generators.find((g) => g.id === generatorId) ?? null,
    printer: printers.find((p) => p.id === printerId)?.name ?? printerId,
    profile: profiles.find((p) => p.id === profileId)?.name ?? profileId,
  };
}
