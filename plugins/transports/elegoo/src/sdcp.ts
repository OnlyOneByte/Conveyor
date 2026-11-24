import { decodeFrame, decodeShape, ErrorData, PushEnvelope, StatusData } from "./frames.js";

export const SDCP_CMD = {
  STATUS: 0,
  ATTRIBUTES: 1,
  START_PRINT: 128,
  STOP_PRINT: 130,
} as const;

export type SdcpRead<T> =
  | { kind: "frame"; frame: T }
  | { kind: "other"; reason: string }
  | { kind: "malformed"; reason: string };

export function exhaustive(value: never): never {
  throw new Error(`unhandled SDCP read: ${JSON.stringify(value)}`);
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
  currentTicks: number | null;
  totalTicks: number | null;
}

export type SdcpPush =
  | { kind: "status"; status: SdcpStatusFrame }
  | { kind: "error"; errorCode: number | string };

function progressOf(pi: { Progress?: number; CurrentLayer?: number; TotalLayer?: number }): number {
  if (pi.Progress !== undefined) return pi.Progress > 1 ? pi.Progress / 100 : pi.Progress;
  if (pi.TotalLayer) return (pi.CurrentLayer ?? 0) / pi.TotalLayer;
  return 0;
}

function readStatus(data: unknown, buf: string): SdcpRead<SdcpPush> {
  const decoded = decodeShape(StatusData, data, buf);
  if (decoded.kind === "malformed") return decoded;
  const { CurrentStatus, PrintInfo: pi } = decoded.value.Status;
  const currentStatus = CurrentStatus === undefined ? [] : [CurrentStatus].flat();
  const status: SdcpStatusFrame = {
    currentStatus,
    printStatus: pi.Status ?? null,
    progress: Math.max(0, Math.min(1, progressOf(pi))),
    currentLayer: pi.CurrentLayer ?? null,
    totalLayer: pi.TotalLayer ?? null,
    currentTicks: pi.CurrentTicks ?? null,
    totalTicks: pi.TotalTicks ?? null,
  };
  return { kind: "frame", frame: { kind: "status", status } };
}

function readError(data: unknown, buf: string): SdcpRead<SdcpPush> {
  const decoded = decodeShape(ErrorData, data, buf);
  if (decoded.kind === "malformed") return decoded;
  return { kind: "frame", frame: { kind: "error", errorCode: decoded.value.Data.ErrorCode } };
}

export function parsePushFrame(buf: string): SdcpRead<SdcpPush> {
  const envelope = decodeFrame(PushEnvelope, buf);
  if (envelope.kind === "malformed") return envelope;
  const { Topic, Data, Status } = envelope.value;
  if (Topic.startsWith("sdcp/status/"))
    return readStatus(Status === undefined ? Data : { Status }, buf);
  if (Topic.startsWith("sdcp/error/")) return readError(Data, buf);
  return { kind: "other", reason: `topic ${JSON.stringify(Topic)}` };
}
