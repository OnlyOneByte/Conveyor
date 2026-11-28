export const CROSS_ORIGIN_REFUSED = "cross-origin request refused";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const OWN_FETCH_SITES = new Set(["same-origin", "none"]);

export interface WriteRequest {
  method: string;
  host: string;
  origin: string | undefined;
  fetchSite: string | undefined;
}

export function isCrossOriginWrite({ method, host, origin, fetchSite }: WriteRequest): boolean {
  if (SAFE_METHODS.has(method)) return false;
  if (fetchSite !== undefined && !OWN_FETCH_SITES.has(fetchSite)) return true;
  if (origin === undefined) return false;
  try {
    const from = new URL(origin);
    return from.host === "" || from.host !== new URL(`${from.protocol}//${host}`).host;
  } catch {
    return true;
  }
}
