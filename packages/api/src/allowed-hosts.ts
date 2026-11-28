import { isPublicSuffix } from "./public-suffix.js";

export class AllowedHostsError extends Error {
  override name = "AllowedHostsError";
}

export const UNKNOWN_HOST_REFUSED =
  "unknown host: the API answers only to the names in CONVEYOR_ALLOWED_HOSTS, CONVEYOR_DOMAIN and localhost";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const HOST_NAME = /^(\[[0-9a-f:.]+\]|[a-z0-9_-]+(\.[a-z0-9_-]+)*)$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export interface AllowedHosts {
  names: ReadonlySet<string>;
  suffixes: readonly string[];
}

type Env = Record<string, string | undefined>;
type Entry = { name: string } | { suffix: string } | "any-host" | undefined;

function hostnameOf(value: string): string | undefined {
  if (value === "" || /[/?#@\\]/.test(value)) return undefined;
  try {
    const name = new URL(`http://${value}`).hostname.replace(/\.$/, "");
    return HOST_NAME.test(name) ? name : undefined;
  } catch {
    return undefined;
  }
}

function entryOf(raw: string): Entry {
  const bare = raw.replace(SCHEME, "").replace(/\/$/, "");
  if (bare === "" || /^:\d+$/.test(bare)) return "any-host";
  if (!bare.startsWith("*.")) {
    const name = hostnameOf(bare);
    return name === undefined ? undefined : { name };
  }
  const suffix = hostnameOf(bare.slice(2));
  return suffix === undefined || suffix.startsWith("[") ? undefined : { suffix };
}

function parseList(variable: string, raw: string | undefined): Exclude<Entry, undefined>[] {
  const tokens = (raw ?? "").split(/[\s,]+/).filter((token) => token !== "");
  const entries = tokens.map((token) => ({ token, entry: entryOf(token) }));
  const shared = entries.flatMap(({ token, entry }) =>
    typeof entry === "object" && "suffix" in entry && isPublicSuffix(entry.suffix) ? [token] : [],
  );
  if (shared.length > 0) {
    throw new AllowedHostsError(
      `${variable} has wildcards over a public or shared zone: ${shared.map((s) => JSON.stringify(s)).join(", ")}. Anyone can get a name in such a zone and point it at this API, which would get past the Host check. Use a zone that belongs to you alone, such as *.home.example.com, or list the names, then restart.`,
    );
  }
  const bad = entries.filter(({ entry }) => entry === undefined).map(({ token }) => token);
  if (bad.length > 0) {
    throw new AllowedHostsError(
      `${variable} has entries that aren't host names or IP addresses: ${bad.map((b) => JSON.stringify(b)).join(", ")}. List names like printer.lan, 192.168.1.40, [fd00::4] or *.example.com, separated by commas, then restart.`,
    );
  }
  return entries.flatMap(({ entry }) => (entry === undefined ? [] : [entry]));
}

export function allowedHosts(env: Env): AllowedHosts {
  const entries = [
    ...LOOPBACK_HOSTS.map((name) => ({ name })),
    ...parseList("CONVEYOR_DOMAIN", env.CONVEYOR_DOMAIN),
    ...parseList("CONVEYOR_ALLOWED_HOSTS", env.CONVEYOR_ALLOWED_HOSTS),
  ];
  return {
    names: new Set(entries.flatMap((e) => (typeof e === "object" && "name" in e ? [e.name] : []))),
    suffixes: entries.flatMap((e) => (typeof e === "object" && "suffix" in e ? [e.suffix] : [])),
  };
}

export function hostAllowed(allowed: AllowedHosts, host: string): boolean {
  const name = hostnameOf(host);
  if (name === undefined) return false;
  return allowed.names.has(name) || allowed.suffixes.some((suffix) => name.endsWith(`.${suffix}`));
}
