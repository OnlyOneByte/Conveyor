import { isIPv4, isIPv6 } from "node:net";

export type HostPort =
  | { kind: "parsed"; host: string; port: number }
  | { kind: "invalid"; reason: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const USERINFO = /^((?:[a-z][a-z0-9+.-]*:)?\/\/)?.*@/i;
const BRACKETED = /^\[([^\]]*)\](?::(.*))?$/;
const HOSTNAME =
  /^(?=.{1,253}\.?$)[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*\.?$/i;
const PORT_RANGE = "the port must be a number from 1 to 65535";

function redact(text: string): string {
  return text.replace(USERINFO, "$1***@");
}

function invalid(address: string, why: string): HostPort {
  return { kind: "invalid", reason: `${JSON.stringify(redact(address))}: ${why}` };
}

function portOf(text: string): number | undefined {
  if (!/^\d{1,5}$/.test(text)) return undefined;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : undefined;
}

function withPort(text: string, host: string, portText: string): HostPort {
  const port = portOf(portText);
  if (port === undefined) return invalid(text, PORT_RANGE);
  return { kind: "parsed", host, port };
}

function parseUrl(text: string, defaultPort: number): HostPort {
  if (!URL.canParse(text)) return invalid(text, "not a valid URL");
  const url = new URL(text);
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (!host) return invalid(text, "the URL has no host");
  if (url.port) return withPort(text, host, url.port);
  return { kind: "parsed", host, port: url.protocol === "https:" ? 443 : defaultPort };
}

function parseBracketed(text: string, defaultPort: number): HostPort {
  const match = text.match(BRACKETED);
  const host = match?.[1] ?? "";
  if (!isIPv6(host))
    return invalid(text, "brackets must hold an IPv6 address, as in [fe80::1]:3030");
  const portText = match?.[2];
  if (portText === undefined) return { kind: "parsed", host, port: defaultPort };
  return withPort(text, host, portText);
}

function parseHost(text: string, defaultPort: number): HostPort {
  const colon = text.indexOf(":");
  const host = colon === -1 ? text : text.slice(0, colon);
  if (/^[\d.]+$/.test(host) && !isIPv4(host)) return invalid(text, "not a valid IPv4 address");
  if (!HOSTNAME.test(host)) return invalid(text, "not an IPv4 address, IPv6 address or hostname");
  if (colon === -1) return { kind: "parsed", host, port: defaultPort };
  return withPort(text, host, text.slice(colon + 1));
}

export function parseHostPort(address: string, defaultPort: number): HostPort {
  const text = address.trim();
  if (!text) return invalid(address, "the address is empty");
  if (SCHEME.test(text)) return parseUrl(text, defaultPort);
  if (text.startsWith("[")) return parseBracketed(text, defaultPort);
  if (isIPv6(text)) return { kind: "parsed", host: text, port: defaultPort };
  if (text.indexOf(":") !== text.lastIndexOf(":"))
    return invalid(text, "not a valid IPv6 address; to give a port, write it as [fe80::1]:3030");
  return parseHost(text, defaultPort);
}

export function formatHostPort(host: string, port: number): string {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}
