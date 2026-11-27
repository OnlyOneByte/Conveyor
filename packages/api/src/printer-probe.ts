import { createConnection } from "node:net";
import { type HostPort, hostPortOf, parseHostPort } from "@conveyor/shared/address";

interface ReachResult {
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

export function parseAddress(address: string, transportId: string): HostPort {
  const hostPort = hostPortOf(address);
  const shown = hostPort === address ? undefined : address;
  return parseHostPort(hostPort, DEFAULT_PORTS[transportId] ?? 80, shown);
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
