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

export function parseDiscovery(buf: string): SdcpDiscovery | null {
  try {
    const j = JSON.parse(buf);
    const d = j.Data ?? j.data ?? {};
    const mainboardIp = d.MainboardIP ?? d.mainboardIP;
    const mainboardId = d.MainboardID ?? d.mainboardID;
    if (!mainboardIp || !mainboardId) return null;
    return {
      name: d.Name ?? d.name ?? "Elegoo printer",
      machineName: d.MachineName ?? d.machineName ?? "",
      brand: d.BrandName ?? d.brandName ?? "Elegoo",
      mainboardIp,
      mainboardId,
      protocolVersion: d.ProtocolVersion,
      firmwareVersion: d.FirmwareVersion,
    };
  } catch {
    return null;
  }
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

export function parseStatusFrame(buf: string): SdcpStatusFrame | null {
  try {
    const j = JSON.parse(buf);
    const topic: string = j.Topic ?? "";
    if (!topic.startsWith("sdcp/status/")) return null;
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
      currentStatus: cur,
      printStatus: typeof pi.Status === "number" ? pi.Status : null,
      progress: Math.max(0, Math.min(1, progress)),
      currentLayer: pi.CurrentLayer ?? null,
      totalLayer: pi.TotalLayer ?? null,
    };
  } catch {
    return null;
  }
}
