import { createConnection, isIPv4, isIPv6 } from "node:net";

export interface ReachResult {
  reachable: boolean;
  latencyMs?: number;
  host: string;
  port: number;
  reason?: string;
}

const DEFAULT_PORTS: Record<string, number> = {
  moonraker: 80,
  elegoo: 3030,
};

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const BRACKETED = /^\[([^\]]*)\](?::(.*))?$/;
const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export type ParsedAddress =
  | { kind: "parsed"; host: string; port: number }
  | { kind: "invalid"; reason: string };

function defaultPort(transportId: string): number {
  return DEFAULT_PORTS[transportId] ?? 80;
}

function invalid(address: string, why: string): ParsedAddress {
  return { kind: "invalid", reason: `${JSON.stringify(address)}: ${why}` };
}

function portOf(text: string): number | undefined {
  if (!/^\d{1,5}$/.test(text)) return undefined;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : undefined;
}

function parseUrl(text: string, transportId: string): ParsedAddress {
  let url: URL;
  try {
    url = new URL(text);
  } catch (e) {
    return invalid(text, `not a valid URL (${e instanceof Error ? e.message : String(e)})`);
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (!host) return invalid(text, "the URL has no host");
  if (url.port) return { kind: "parsed", host, port: Number(url.port) };
  const port = url.protocol === "https:" ? 443 : defaultPort(transportId);
  return { kind: "parsed", host, port };
}

function parseBracketed(text: string, transportId: string): ParsedAddress {
  const match = text.match(BRACKETED);
  const host = match?.[1] ?? "";
  if (!isIPv6(host))
    return invalid(text, "brackets must hold an IPv6 address, as in [fe80::1]:3030");
  const portText = match?.[2];
  if (portText === undefined) return { kind: "parsed", host, port: defaultPort(transportId) };
  const port = portOf(portText);
  if (port === undefined) return invalid(text, "the port must be a number from 1 to 65535");
  return { kind: "parsed", host, port };
}

function parseHost(text: string, transportId: string): ParsedAddress {
  const colon = text.indexOf(":");
  const host = colon === -1 ? text : text.slice(0, colon);
  if (/^[\d.]+$/.test(host) && !isIPv4(host)) return invalid(text, "not a valid IPv4 address");
  if (!HOSTNAME.test(host)) return invalid(text, "not an IPv4 address, IPv6 address or hostname");
  if (colon === -1) return { kind: "parsed", host, port: defaultPort(transportId) };
  const port = portOf(text.slice(colon + 1));
  if (port === undefined) return invalid(text, "the port must be a number from 1 to 65535");
  return { kind: "parsed", host, port };
}

export function parseAddress(address: string, transportId: string): ParsedAddress {
  const text = address.trim();
  if (!text) return invalid(address, "the address is empty");
  if (SCHEME.test(text)) return parseUrl(text, transportId);
  if (text.startsWith("[")) return parseBracketed(text, transportId);
  if (isIPv6(text)) return { kind: "parsed", host: text, port: defaultPort(transportId) };
  if (text.indexOf(":") !== text.lastIndexOf(":"))
    return invalid(text, "not a valid IPv6 address; to give a port, write it as [fe80::1]:3030");
  return parseHost(text, transportId);
}

export function probePrinter(
  address: string,
  transportId: string,
  timeoutMs = 2000,
): Promise<ReachResult> {
  const parsed = parseAddress(address, transportId);
  if (parsed.kind === "invalid") {
    return Promise.resolve({
      reachable: false,
      host: address,
      port: 0,
      reason: `unparseable address ${parsed.reason}`,
    });
  }
  const { host, port } = parsed;
  const started = Date.now();

  return new Promise<ReachResult>((resolve) => {
    let settled = false;
    const done = (r: ReachResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(r);
    };

    const socket = createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once("connect", () =>
      done({ reachable: true, latencyMs: Date.now() - started, host, port }),
    );
    socket.once("timeout", () => done({ reachable: false, host, port, reason: "timeout" }));
    socket.once("error", (err: NodeJS.ErrnoException) =>
      done({ reachable: false, host, port, reason: err.code ?? err.message }),
    );
  });
}
