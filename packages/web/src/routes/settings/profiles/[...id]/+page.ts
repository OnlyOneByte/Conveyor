import { fetchCatalogProfiles, fetchCatalogSlicers, signedIn } from "#lib/api.js";
import { loadContent } from "#lib/profile-content.js";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, fetch, parent }) => {
  const empty = { profile: null, content: null, slicers: [], failed: false };
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
    };
  } catch {
    return { ...empty, failed: true };
  }
};
