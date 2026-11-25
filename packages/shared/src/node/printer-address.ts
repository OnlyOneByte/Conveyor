import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { parseHostPort } from "../address.js";
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
  ["100.100.100.200", 32, "ipv4", "the Alibaba Cloud metadata service"],
];

const REFUSED_NAMES = new Map([
  ["metadata.google.internal", "the Google Cloud metadata service"],
  ["metadata", "the Google Cloud metadata service"],
]);

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

export class PrinterAddressRefusedError extends Error {
  constructor(
    readonly host: string,
    why: string,
  ) {
    super(
      `Conveyor won't connect to ${host}: it is ${why}, not a printer on your network. If it really is your printer, add ${host} to ${ALLOW_SETTING}.`,
    );
    this.name = "PrinterAddressRefusedError";
  }
}

const defaultLookup: Lookup = async (host) =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

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

function refusedRange(ip: string): string | undefined {
  for (const [base, prefix, kind, why] of REFUSED_RANGES) {
    const range = new BlockList();
    range.addSubnet(base, prefix, kind);
    if (range.check(ip, family(ip))) return why;
  }
  return undefined;
}

export function printerHost(address: string): string | undefined {
  const text = address.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    const parsed = parseHostPort(text, 80);
    return parsed.kind === "parsed" ? normalHost(parsed.host) : undefined;
  }
  const bare = text.replace(/^\/\//, "");
  const slash = bare.indexOf("/");
  const authority = slash === -1 ? bare : bare.slice(0, slash);
  const parsed = parseHostPort(authority.slice(authority.lastIndexOf("@") + 1), 80);
  return parsed.kind === "parsed" ? normalHost(parsed.host) : undefined;
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
  try {
    return await lookup(host);
  } catch {
    return [];
  }
}

export async function checkPrinterAddress(
  address: string,
  { env = process.env, lookup = defaultLookup }: AddressPolicyOptions = {},
): Promise<void> {
  const host = printerHost(address);
  if (host === undefined) return;
  const allowed = allowList(env);
  if (allowed.host(host)) return;
  const named = REFUSED_NAMES.get(host);
  if (named) throw new PrinterAddressRefusedError(host, named);
  for (const ip of await resolved(host, lookup)) {
    const why = allowed.ip(ip) ? undefined : refusedRange(ip);
    if (why) throw new PrinterAddressRefusedError(host, ip === host ? why : `${why} (${ip})`);
  }
}

export async function requirePrinterAddress(
  address: string,
  options?: AddressPolicyOptions,
): Promise<void> {
  try {
    await checkPrinterAddress(address, options);
  } catch (err) {
    throw new StageError("transport", err instanceof Error ? err.message : String(err));
  }
}
