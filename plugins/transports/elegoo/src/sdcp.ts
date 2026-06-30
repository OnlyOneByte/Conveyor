/**
 * SDCP (Smart Device Control Protocol) primitives for Elegoo printers.
 *
 * Reference: ELEGOO/Chitu SDCP V3.0.0
 *   https://github.com/cbd-tech/SDCP-Smart-Device-Control-Protocol-V3.0.0
 *
 * Transport shape:
 *   - Discovery: UDP broadcast "M99999" to :3000; each printer replies with a
 *     JSON datagram describing itself (MainboardIP, MainboardID, …).
 *   - Control:   WebSocket ws://<ip>:3030/websocket — JSON request/response +
 *     pushed status/attribute/error topics.
 *   - Files:     HTTP upload to the mainboard (the exact route/chunking differs
 *     between resin and FDM lines — flagged in index.ts as the spike's #1 risk).
 *
 * ⚠️ Written from the published spec, NOT yet verified against hardware.
 */

/** SDCP request command codes (subset we use). */
export const SDCP_CMD = {
  STATUS: 0, // request a status refresh
  ATTRIBUTES: 1, // request device attributes
  START_PRINT: 128,
  PAUSE_PRINT: 129,
  STOP_PRINT: 130,
  RESUME_PRINT: 131,
} as const;

/** PrintInfo.Status enum (the print sub-state). */
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
  13: "printing", // FDM lines report a generic "printing" sub-state
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

/** Parse a discovery datagram (printers reply to the "M99999" broadcast). */
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

/** Build an SDCP request frame for the device WebSocket. */
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
      From: 0, // 0 = local PC/app
    },
    Topic: `sdcp/request/${mainboardId}`,
  });
}

export interface SdcpStatusFrame {
  /** machine-level status array (1 = printing, 2 = transferring) */
  currentStatus: number[];
  /** print sub-status enum (see SDCP_PRINT_STATUS) */
  printStatus: number | null;
  /** 0..1 */
  progress: number;
  currentLayer: number | null;
  totalLayer: number | null;
}

/** Extract the status fields from a pushed `sdcp/status/<id>` frame. */
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
    // PrintInfo.Progress is a 0..100 percentage on most firmware; normalize. If
    // absent, derive from layer counts.
    let progress = 0;
    if (typeof pi.Progress === "number") progress = pi.Progress > 1 ? pi.Progress / 100 : pi.Progress;
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
