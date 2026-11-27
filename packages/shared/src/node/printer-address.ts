import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { addressParts, hasScheme } from "../address.js";
import { StageError } from "../context.js";

export const ALLOW_SETTING = "PRINTER_ADDRESS_ALLOW";

export type Lookup = (host: string) => Promise<string[]>;

export interface AddressPolicyOptions {
  env?: Record<string, string | undefined>;
  lookup?: Lookup;
}

const REFUSED_RANGES: [string, number, "ipv4" | "ipv6", string][] = [
  ["169.254.0.0", 16, "ipv4", "a link-local address, where cloud metadata services listen"],
  ["fe80::", 10, "ipv6", "an IPv6 link-local address"],
  ["fd00:ec2::254", 128, "ipv6", "the AWS metadata service"],
  ["fd20:ce::254", 128, "ipv6", "the Google Cloud metadata service"],
  ["100.100.100.200", 32, "ipv4", "the Alibaba Cloud metadata service"],
];

const REFUSED_NAMES = new Map([
  ["metadata.google.internal", "the Google Cloud metadata service"],
  ["metadata", "the Google Cloud metadata service"],
]);

const EMBEDDING = new BlockList();
EMBEDDING.addSubnet("64:ff9b::", 96, "ipv6");
EMBEDDING.addSubnet("64:ff9b:1::", 48, "ipv6");
EMBEDDING.addSubnet("::", 96, "ipv6");

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

export class PrinterAddressRefusedError extends Error {
  constructor(
    readonly host: string,
    why: string,
    message = `Conveyor won't connect to ${host}: it is ${why}, not a printer on your network. If it really is your printer, add ${host} to ${ALLOW_SETTING}.`,
  ) {
    super(message);
    this.name = "PrinterAddressRefusedError";
  }
}

export const PRINTER_SCHEMES = ["http", "https", "ws", "wss"];

export class PrinterSchemeRefusedError extends PrinterAddressRefusedError {
  constructor(host: string, scheme: string) {
    super(
      host,
      "unsupported scheme",
      `Conveyor connects to printers only over ${PRINTER_SCHEMES.join(", ")}, not ${scheme}. Write the address as host:port, or with one of those schemes.`,
    );
    this.name = "PrinterSchemeRefusedError";
  }
}

export class PrinterNameUnresolvedError extends PrinterAddressRefusedError {
  constructor(host: string) {
    super(
      host,
      "unresolved",
      `Conveyor couldn't resolve ${host}, so it can't check where it points. If it really is your printer, add ${host} to ${ALLOW_SETTING}.`,
    );
    this.name = "PrinterNameUnresolvedError";
  }
}

export const printerDns: { resolve: Lookup } = {
  resolve: async (host) =>
    (await dnsLookup(host, { all: true, verbatim: true })).map((entry) => entry.address),
};

const defaultLookup: Lookup = (host) => printerDns.resolve(host);

function family(ip: string): "ipv4" | "ipv6" {
  return isIP(ip) === 6 ? "ipv6" : "ipv4";
}

function normalHost(host: string): string {
  return host
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.$/, "")
    .toLowerCase();
}

export function allowList(env: Record<string, string | undefined>) {
  const ips = new BlockList();
  const hosts = new Set<string>();
  for (const entry of (env[ALLOW_SETTING] ?? "").split(/[\s,]+/).filter(Boolean)) {
    const [base = "", prefix] = entry.split("/");
    if (isIP(base) === 0) {
      if (prefix !== undefined) throw new Error(`${ALLOW_SETTING}: ${entry} is not a valid CIDR`);
      hosts.add(normalHost(entry));
    } else if (prefix === undefined) ips.addAddress(base, family(base));
    else if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > (family(base) === "ipv4" ? 32 : 128))
      throw new Error(`${ALLOW_SETTING}: ${entry} is not a valid CIDR`);
    else ips.addSubnet(base, Number(prefix), family(base));
  }
  return {
    host: (host: string) => hosts.has(normalHost(host)),
    ip: (ip: string) => ips.check(ip, family(ip)),
  };
}

function embeddedIPv4(ip: string): string | undefined {
  if (isIP(ip) !== 6 || ip === "::" || ip === "::1" || !EMBEDDING.check(ip, "ipv6"))
    return undefined;
  const tail = ip.slice(ip.lastIndexOf(":") + 1);
  if (isIP(tail) === 4) return tail;
  const groups = ip.split(":");
  const low = Number.parseInt(groups.at(-1) || "0", 16);
  const high = ip.endsWith(`::${groups.at(-1)}`) ? 0 : Number.parseInt(groups.at(-2) || "0", 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

function refusedRange(ip: string): string | undefined {
  for (const [base, prefix, kind, why] of REFUSED_RANGES) {
    const range = new BlockList();
    range.addSubnet(base, prefix, kind);
    if (range.check(ip, family(ip))) return why;
  }
  const embedded = embeddedIPv4(ip);
  const why = embedded === undefined ? undefined : refusedRange(embedded);
  return why && `${why}, embedded in an IPv6 address`;
}

function authorityOf(text: string): string {
  const { host } = addressParts(text);
  return isIP(host) === 6 ? `[${host}]` : host;
}

export function printerHost(address: string): string | undefined {
  const text = address.trim();
  const url = hasScheme(text) ? text : `http://${authorityOf(text)}`;
  if (!URL.canParse(url)) return undefined;
  return normalHost(new URL(url).hostname) || undefined;
}

export function isLoopbackHost(host: string): boolean {
  const name = normalHost(host);
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  return isIP(name) !== 0 && LOOPBACK.check(name, family(name));
}

export function loopbackPrinters(printers: { id: string; address: string }[]): string[] {
  return printers
    .filter((printer) => {
      const host = printerHost(printer.address);
      return host !== undefined && isLoopbackHost(host);
    })
    .map((printer) => printer.id);
}

async function resolved(host: string, lookup: Lookup): Promise<string[]> {
  if (isIP(host) !== 0) return [host];
  const ips = await lookup(host).catch(() => []);
  if (ips.length === 0) throw new PrinterNameUnresolvedError(host);
  return ips;
}

function schemeOf(address: string): string | undefined {
  const text = address.trim();
  return hasScheme(text) ? text.slice(0, text.indexOf(":")).toLowerCase() : undefined;
}

export async function checkPrinterAddress(
  address: string,
  { env = process.env, lookup = defaultLookup }: AddressPolicyOptions = {},
): Promise<string | undefined> {
  const scheme = schemeOf(address);
  const host = printerHost(address);
  if (scheme !== undefined && !PRINTER_SCHEMES.includes(scheme))
    throw new PrinterSchemeRefusedError(host ?? address.trim(), `${scheme}://`);
  if (host === undefined) return undefined;
  const allowed = allowList(env);
  if (allowed.host(host)) return undefined;
  const named = REFUSED_NAMES.get(host);
  if (named) throw new PrinterAddressRefusedError(host, named);
  const ips = await resolved(host, lookup);
  for (const ip of ips) {
    const why = allowed.ip(ip) ? undefined : refusedRange(ip);
    if (why) throw new PrinterAddressRefusedError(host, ip === host ? why : `${why} (${ip})`);
  }
  return ips[0];
}

export function pinnedUrl(url: string, ip: string | undefined): { url: string; host?: string } {
  const parsed = new URL(url);
  if (ip === undefined || (parsed.protocol !== "http:" && parsed.protocol !== "ws:"))
    return { url };
  if (normalHost(parsed.hostname) === normalHost(ip)) return { url };
  const host = parsed.host;
  parsed.hostname = isIP(ip) === 6 ? `[${ip}]` : ip;
  const pinned = parsed.toString();
  const trimmed = !url.endsWith("/") && pinned.endsWith("/") ? pinned.slice(0, -1) : pinned;
  return { url: trimmed, host };
}

export async function requirePrinterAddress(
  address: string,
  options?: AddressPolicyOptions,
): Promise<string | undefined> {
  try {
    return await checkPrinterAddress(address, options);
  } catch (err) {
    throw new StageError("transport", err instanceof Error ? err.message : String(err), {
      cause: err,
    });
  }
}

export function refuseRedirect(res: Response, what: string): void {
  if (res.status < 300 || res.status > 399) return;
  const to = res.headers.get("location") ?? "another address";
  throw new StageError(
    "transport",
    `${what} was redirected (${res.status}) to ${to}; Conveyor doesn't follow redirects from a printer`,
  );
}
