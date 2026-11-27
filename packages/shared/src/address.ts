import { isIPv4, isIPv6 } from "node:net";

export type HostPort =
  | { kind: "parsed"; host: string; port: number }
  | { kind: "invalid"; reason: string };

type Parsed = { kind: "parsed"; host: string; port: number };
type Problem = { kind: "invalid"; why: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const USERINFO = /^((?:[a-z][a-z0-9+.-]*:)?\/\/)?[\s\S]*@/i;
const CONTROL = /\p{Cc}/u;
const BRACKETED = /^\[([^\]]*)\](?::(.*))?$/;
const HOSTNAME =
  /^(?=.{1,253}\.?$)[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*\.?$/i;
const PORT_RANGE = "the port must be a number from 1 to 65535";
const ZONE_ID =
  "IPv6 zone IDs such as %eth0 can't be used in a printer URL; give the address without the zone";

function redactAddress(text: string): string {
  return text.replace(USERINFO, "$1***@");
}

function problem(why: string): Problem {
  return { kind: "invalid", why };
}

function portOf(text: string): number | undefined {
  if (!/^\d{1,5}$/.test(text)) return undefined;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : undefined;
}

function withPort(host: string, portText: string): Parsed | Problem {
  const port = portOf(portText);
  if (port === undefined) return problem(PORT_RANGE);
  return { kind: "parsed", host, port };
}

function parseUrl(text: string, defaultPort: number): Parsed | Problem {
  if (!URL.canParse(text)) return problem("not a valid URL");
  const url = new URL(text);
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (!host) return problem("the URL has no host");
  if (url.port) return withPort(host, url.port);
  return { kind: "parsed", host, port: url.protocol === "https:" ? 443 : defaultPort };
}

function parseBracketed(text: string, defaultPort: number): Parsed | Problem {
  const match = text.match(BRACKETED);
  const host = match?.[1] ?? "";
  if (!isIPv6(host)) return problem("brackets must hold an IPv6 address, as in [fe80::1]:3030");
  if (host.includes("%")) return problem(ZONE_ID);
  const portText = match?.[2];
  if (portText === undefined) return { kind: "parsed", host, port: defaultPort };
  return withPort(host, portText);
}

function parseHost(text: string, defaultPort: number): Parsed | Problem {
  const colon = text.indexOf(":");
  const host = colon === -1 ? text : text.slice(0, colon);
  if (/^[\d.]+$/.test(host) && !isIPv4(host)) return problem("not a valid IPv4 address");
  if (!HOSTNAME.test(host)) return problem("not an IPv4 address, IPv6 address or hostname");
  if (colon === -1) return { kind: "parsed", host, port: defaultPort };
  return withPort(host, text.slice(colon + 1));
}

function parseText(text: string, defaultPort: number): Parsed | Problem {
  if (!text) return problem("the address is empty");
  if (SCHEME.test(text)) return parseUrl(text, defaultPort);
  if (text.startsWith("[")) return parseBracketed(text, defaultPort);
  if (isIPv6(text))
    return text.includes("%")
      ? problem(ZONE_ID)
      : { kind: "parsed", host: text, port: defaultPort };
  if (text.indexOf(":") !== text.lastIndexOf(":"))
    return problem("not a valid IPv6 address; to give a port, write it as [fe80::1]:3030");
  return parseHost(text, defaultPort);
}

export function parseHostPort(address: string, defaultPort: number, shown?: string): HostPort {
  const text = address.trim();
  const quoted = shown?.trim() ?? (text || address);
  const result = CONTROL.test(`${shown?.trim() ?? ""}${text}`)
    ? problem("the address contains a control character or line break")
    : parseText(text, defaultPort);
  if (result.kind === "parsed") return result;
  return { kind: "invalid", reason: `${JSON.stringify(redactAddress(quoted))}: ${result.why}` };
}

export function formatHostPort(host: string, port: number): string {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}

export const hasScheme = (address: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(address.trim());

export function hostPortOf(address: string): string {
  return hasScheme(address) ? address : addressParts(address).host;
}

export function addressParts(address: string): { host: string; path: string } {
  const bare = address.replace(/^\/\//, "");
  const slash = bare.indexOf("/");
  const authority = slash === -1 ? bare : bare.slice(0, slash);
  const path = slash === -1 ? "" : bare.slice(slash);
  return { host: authority.slice(authority.lastIndexOf("@") + 1), path };
}
