export class AllowedHostsError extends Error {
  override name = "AllowedHostsError";
}

export const UNKNOWN_HOST_REFUSED = "unknown host";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const HOST_NAME = /^(\[[0-9a-f:.]+\]|[a-z0-9-]+(\.[a-z0-9-]+)*)$/;

type Env = Record<string, string | undefined>;

function hostnameOf(value: string): string | undefined {
  const bare = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  if (bare === "" || /[/?#@\\]/.test(bare)) return undefined;
  try {
    const name = new URL(`http://${bare}`).hostname.replace(/\.$/, "");
    return HOST_NAME.test(name) ? name : undefined;
  } catch {
    return undefined;
  }
}

function parseList(variable: string, raw: string | undefined): string[] {
  const entries = (raw ?? "").split(/[\s,]+/).filter((entry) => entry !== "");
  const names = entries.map((entry) => ({ entry, name: hostnameOf(entry) }));
  const bad = names.filter(({ name }) => name === undefined).map(({ entry }) => entry);
  if (bad.length > 0) {
    throw new AllowedHostsError(
      `${variable} must be a comma-separated list of host names or IP addresses (an optional scheme or port is ignored), got ${bad.map((b) => JSON.stringify(b)).join(", ")}`,
    );
  }
  return names.flatMap(({ name }) => (name === undefined ? [] : [name]));
}

export function allowedHosts(env: Env): ReadonlySet<string> {
  return new Set([
    ...LOOPBACK_HOSTS,
    ...parseList("CONVEYOR_DOMAIN", env.CONVEYOR_DOMAIN),
    ...parseList("CONVEYOR_ALLOWED_HOSTS", env.CONVEYOR_ALLOWED_HOSTS),
  ]);
}

export function hostAllowed(allowed: ReadonlySet<string>, host: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) return false;
  const name = hostnameOf(host);
  return name !== undefined && allowed.has(name);
}
