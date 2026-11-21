export const SDCP_CMD = {
  STATUS: 0,
  ATTRIBUTES: 1,
  START_PRINT: 128,
  PAUSE_PRINT: 129,
  STOP_PRINT: 130,
  RESUME_PRINT: 131,
} as const;

export const SDCP_PRINT_STATUS: Record<number, string> = {
  0: "idle",
  1: "homing",
  2: "dropping",
  3: "exposuring",
  4: "lifting",
  5: "pausing",
  6: "paused",
  7: "stopping",
  8: "stopped",
  9: "complete",
  10: "filechecking",
  13: "printing",
} as const;

export interface SdcpDiscovery {
  name: string;
  machineName: string;
  brand: string;
  mainboardIp: string;
  mainboardId: string;
  protocolVersion?: string;
  firmwareVersion?: string;
}

export type SdcpRead<T> =
  | { kind: "frame"; frame: T }
  | { kind: "other"; reason: string }
  | { kind: "malformed"; reason: string };

export type DiscoveryOutcome =
  | { kind: "found"; printers: SdcpDiscovery[] }
  | { kind: "none"; reasons: string[] };

export function exhaustive(value: never): never {
  throw new Error(`unhandled SDCP read: ${JSON.stringify(value)}`);
}

export function malformed(raw: string, e: unknown): { kind: "malformed"; reason: string } {
  const why = e instanceof Error ? e.message : String(e);
  return { kind: "malformed", reason: `${why} in ${JSON.stringify(raw.slice(0, 80))}` };
}

export function parseDiscovery(buf: string): SdcpRead<SdcpDiscovery> {
  try {
    const j = JSON.parse(buf);
    const d = j.Data ?? j.data ?? {};
    const mainboardIp = d.MainboardIP ?? d.mainboardIP;
    const mainboardId = d.MainboardID ?? d.mainboardID;
    if (!mainboardIp || !mainboardId)
      return { kind: "other", reason: "reply has no MainboardIP or MainboardID" };
    return {
      kind: "frame",
      frame: {
        name: d.Name ?? d.name ?? "Elegoo printer",
        machineName: d.MachineName ?? d.machineName ?? "",
        brand: d.BrandName ?? d.brandName ?? "Elegoo",
        mainboardIp,
        mainboardId,
        protocolVersion: d.ProtocolVersion,
        firmwareVersion: d.FirmwareVersion,
      },
    };
  } catch (e) {
    return malformed(buf, e);
  }
}

export function discoveryOutcome(reads: SdcpRead<SdcpDiscovery>[]): DiscoveryOutcome {
  const printers = new Map<string, SdcpDiscovery>();
  const reasons: string[] = [];
  for (const read of reads) {
    switch (read.kind) {
      case "frame":
        printers.set(read.frame.mainboardId, read.frame);
        break;
      case "other":
      case "malformed":
        reasons.push(read.reason);
        break;
      default:
        exhaustive(read);
    }
  }
  if (printers.size === 0 && reasons.length > 0) return { kind: "none", reasons };
  return { kind: "found", printers: [...printers.values()] };
}

export function buildCommand(
  mainboardId: string,
  cmd: number,
  data: Record<string, unknown>,
  requestId: string,
  timestamp: number,
): string {
  return JSON.stringify({
    Id: requestId,
    Data: {
      Cmd: cmd,
      Data: data,
      RequestID: requestId,
      MainboardID: mainboardId,
      TimeStamp: timestamp,
      From: 0,
    },
    Topic: `sdcp/request/${mainboardId}`,
  });
}

export interface SdcpStatusFrame {
  currentStatus: number[];
  printStatus: number | null;
  progress: number;
  currentLayer: number | null;
  totalLayer: number | null;
}

export function parseStatusFrame(buf: string): SdcpRead<SdcpStatusFrame> {
  try {
    const j = JSON.parse(buf);
    const topic: string = j.Topic ?? "";
    if (!topic.startsWith("sdcp/status/"))
      return { kind: "other", reason: `topic ${JSON.stringify(topic)}` };
    const status = j.Data?.Status ?? {};
    const pi = status.PrintInfo ?? {};
    const cur: number[] = Array.isArray(status.CurrentStatus)
      ? status.CurrentStatus
      : status.CurrentStatus != null
        ? [status.CurrentStatus]
        : [];
    let progress = 0;
    if (typeof pi.Progress === "number")
      progress = pi.Progress > 1 ? pi.Progress / 100 : pi.Progress;
    else if (pi.TotalLayer) progress = (pi.CurrentLayer ?? 0) / pi.TotalLayer;
    return {
      kind: "frame",
      frame: {
        currentStatus: cur,
        printStatus: typeof pi.Status === "number" ? pi.Status : null,
        progress: Math.max(0, Math.min(1, progress)),
        currentLayer: pi.CurrentLayer ?? null,
        totalLayer: pi.TotalLayer ?? null,
      },
    };
  } catch (e) {
    return malformed(buf, e);
  }
}
