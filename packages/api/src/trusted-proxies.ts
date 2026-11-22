import { isIP, isIPv4 } from "node:net";

class TrustedProxiesError extends Error {
  override name = "TrustedProxiesError";
}

function validEntry(entry: string): boolean {
  const [address, prefix, extra] = entry.split("/");
  if (extra !== undefined || !address) return false;
  const family = isIP(address);
  if (family === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

export function parseTrustedProxies(raw: string | undefined): string[] | false {
  if (raw === undefined || raw.trim() === "") return false;
  const entries = raw.split(",").map((entry) => entry.trim());
  const bad = entries.filter((entry) => !validEntry(entry));
  if (bad.length > 0) {
    throw new TrustedProxiesError(
      `CONVEYOR_TRUSTED_PROXIES must be a comma-separated list of IP addresses or CIDRs, got ${bad.map((b) => JSON.stringify(b)).join(", ")}`,
    );
  }
  return entries;
}

function expandIPv6(address: string): string[] {
  const [head = "", tail] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const missing = tail === undefined ? 0 : 8 - left.length - right.length;
  return [...left, ...Array<string>(missing).fill("0"), ...right];
}

export function clientKey(ip: string): string {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return mapped[1];
  if (isIPv4(ip) || isIP(ip) !== 6) return ip;
  const groups = expandIPv6(ip.toLowerCase().split("%")[0] ?? ip);
  return `${groups
    .slice(0, 4)
    .map((g) => Number.parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}
