import { createConnection } from "node:net";

/**
 * Transport-agnostic reachability: printers are addressed as `host:port` (Moonraker
 * carries an `http(s)://host:port` base, Elegoo a bare IP over SDCP). A TCP connect
 * is the common denominator — it proves the box answers on the wire without needing a
 * transport-specific health call or any printer secret. It is a liveness signal, not a
 * "ready to print" one: a reachable printer may still refuse a job.
 */
export interface ReachResult {
  reachable: boolean;
  /** round-trip ms of the TCP connect, when reachable */
  latencyMs?: number;
  /** parsed target actually probed, for display/debugging */
  host: string;
  port: number;
  /** failure reason when unreachable (ECONNREFUSED, ETIMEDOUT, …) */
  reason?: string;
}

/** Default TCP ports per transport when the address omits an explicit port. */
const DEFAULT_PORTS: Record<string, number> = {
  moonraker: 80, // Moonraker's HTTP API; https bases fall back to 443 below
  elegoo: 3030, // Elegoo SDCP websocket/control port
};

/**
 * Extract host + port from a printer address. Accepts `http(s)://host:port(/path)`,
 * `host:port`, and a bare `host`/IP. Never throws — returns null when no host can be
 * read, so the caller reports "unparseable address" rather than crashing.
 */
export function parseAddress(address: string, transportId: string): { host: string; port: number } | null {
  const trimmed = address.trim();
  if (!trimmed) return null;

  // URL form: let the URL parser handle host, port, and scheme-derived default.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : DEFAULT_PORTS[transportId] ?? 80;
      if (!u.hostname) return null;
      return { host: u.hostname, port };
    } catch {
      return null;
    }
  }

  // host:port — split on the LAST colon so IPv6-in-brackets and bare hosts both work.
  const bracket = trimmed.match(/^\[(.+)\]:(\d+)$/); // [::1]:7125
  if (bracket) return { host: bracket[1], port: Number(bracket[2]) };
  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon > 0 && /^\d+$/.test(trimmed.slice(lastColon + 1))) {
    return { host: trimmed.slice(0, lastColon), port: Number(trimmed.slice(lastColon + 1)) };
  }

  // bare host / IP → transport default port.
  return { host: trimmed, port: DEFAULT_PORTS[transportId] ?? 80 };
}

/** TCP-connect probe with a bounded timeout. Resolves; never rejects. */
export function probePrinter(
  address: string,
  transportId: string,
  timeoutMs = 2000,
): Promise<ReachResult> {
  const parsed = parseAddress(address, transportId);
  if (!parsed) {
    return Promise.resolve({ reachable: false, host: address, port: 0, reason: "unparseable address" });
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
    socket.once("connect", () => done({ reachable: true, latencyMs: Date.now() - started, host, port }));
    socket.once("timeout", () => done({ reachable: false, host, port, reason: "timeout" }));
    socket.once("error", (err: NodeJS.ErrnoException) =>
      done({ reachable: false, host, port, reason: err.code ?? err.message }),
    );
  });
}
