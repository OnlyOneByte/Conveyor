import { createConnection } from "node:net";

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

export function parseAddress(
  address: string,
  transportId: string,
): { host: string; port: number } | null {
  const trimmed = address.trim();
  if (!trimmed) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const port = u.port
        ? Number(u.port)
        : u.protocol === "https:"
          ? 443
          : (DEFAULT_PORTS[transportId] ?? 80);
      if (!u.hostname) return null;
      return { host: u.hostname, port };
    } catch {
      return null;
    }
  }

  const bracket = trimmed.match(/^\[(.+)\]:(\d+)$/);
  if (bracket) return { host: bracket[1], port: Number(bracket[2]) };
  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon > 0 && /^\d+$/.test(trimmed.slice(lastColon + 1))) {
    return { host: trimmed.slice(0, lastColon), port: Number(trimmed.slice(lastColon + 1)) };
  }

  return { host: trimmed, port: DEFAULT_PORTS[transportId] ?? 80 };
}

export function probePrinter(
  address: string,
  transportId: string,
  timeoutMs = 2000,
): Promise<ReachResult> {
  const parsed = parseAddress(address, transportId);
  if (!parsed) {
    return Promise.resolve({
      reachable: false,
      host: address,
      port: 0,
      reason: "unparseable address",
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
