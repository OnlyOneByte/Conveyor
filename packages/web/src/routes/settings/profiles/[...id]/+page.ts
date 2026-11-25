import { fetchCatalogProfiles, fetchCatalogSlicers, signedIn } from "#lib/api.js";
import { unreachable } from "#lib/http-error.js";
import { loadContent } from "#lib/profile-content.js";
import { detailOf, NOT_LOADED, serverSaid } from "#lib/said.js";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, fetch, parent }) => {
  const none: string | null = null;
  const empty = {
    profile: null,
    content: null,
    slicers: [],
    failed: false,
    problem: "",
    detail: none,
  };
  if (!signedIn((await parent()).auth)) return empty;
  try {
    const [profiles, slicers] = await Promise.all([
      fetchCatalogProfiles(fetch),
      fetchCatalogSlicers(fetch),
    ]);
    const profile = profiles.find((p) => p.id === params.id) ?? null;
    return {
      profile,
      slicers,
      content: profile ? await loadContent(profile, fetch) : null,
      failed: false,
      problem: "",
      detail: none,
    };
  } catch (e) {
    if (unreachable(e)) return { ...empty, failed: true };
    return { ...empty, problem: NOT_LOADED, detail: serverSaid(e) ?? detailOf(e) };
  }
};
