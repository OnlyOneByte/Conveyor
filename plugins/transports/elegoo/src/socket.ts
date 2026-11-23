import { randomUUID } from "node:crypto";
import { type PrintProgress, type PrintStatus, StageError } from "@conveyor/shared";
import { AckFrame, decodeFrame } from "./frames.js";
import {
  buildCommand,
  exhaustive,
  parsePushFrame,
  SDCP_CMD,
  type SdcpPush,
  type SdcpRead,
  type SdcpStatusFrame,
} from "./sdcp.js";

export const WS_PORT = Number(process.env.ELEGOO_WS_PORT ?? 3030);
const COMMAND_TIMEOUT_MS = 15000;
export const MAX_BAD_STATUS_FRAMES = 3;

interface StatusStream {
  address: string;
  mainboardId: string;
  idleTimeoutMs: number;
}

interface SdcpCommand {
  mainboardId: string;
  cmd: number;
  data: Record<string, unknown>;
}

function socketUrl(address: string): string {
  return `ws://${address}:${WS_PORT}/websocket`;
}

function nowMs(): number {
  return Date.now();
}

export function ackCode(raw: string, requestId: string): SdcpRead<number> {
  const decoded = decodeFrame(AckFrame, raw);
  if (decoded.kind === "malformed") return decoded;
  const data = decoded.value.Data;
  const ackId = data?.RequestID ?? data?.Data?.RequestID;
  if (ackId !== requestId) return { kind: "other", reason: "not an ack for this request" };
  return { kind: "frame", frame: data?.Data?.Ack ?? data?.Ack ?? 0 };
}

export function sendCommand(
  address: string,
  { mainboardId, cmd, data }: SdcpCommand,
  requireAck = false,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl(address));
    const requestId = randomUUID();
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(
      () => done(new StageError("transport", `elegoo cmd ${cmd} timed out`)),
      COMMAND_TIMEOUT_MS,
    );
    ws.onopen = () => {
      ws.send(buildCommand(mainboardId, cmd, data, requestId, Math.floor(nowMs() / 1000)));
    };
    ws.onmessage = (ev) => {
      const reply = ackCode(String(ev.data), requestId);
      switch (reply.kind) {
        case "other":
          return;
        case "malformed":
          return done(
            new StageError("transport", `elegoo cmd ${cmd}: unreadable reply: ${reply.reason}`),
          );
        case "frame":
          return done(
            reply.frame === 0
              ? undefined
              : new StageError("transport", `elegoo cmd ${cmd} rejected (ack ${reply.frame})`),
          );
        default:
          return exhaustive(reply);
      }
    };
    ws.onerror = () =>
      done(new StageError("transport", `elegoo WS error to ${address}:${WS_PORT}`));
    ws.onclose = () =>
      done(
        requireAck
          ? new StageError("transport", `elegoo cmd ${cmd}: socket closed before the printer acked`)
          : undefined,
      );
  });
}

function toPrintStatus(push: SdcpPush, printing?: PrintStatus): PrintStatus | undefined {
  switch (push.kind) {
    case "error":
      if (printing)
        return {
          ...printing,
          message: `printer reported SDCP error ${push.errorCode} while printing`,
        };
      return { state: "failed", message: `printer reported SDCP error ${push.errorCode}` };
    case "status":
      return printStatusOf(push.status);
    default:
      return exhaustive(push);
  }
}

const isCount = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 0;

function layersOf({ currentLayer, totalLayer }: SdcpStatusFrame): PrintProgress | undefined {
  const print: PrintProgress = {};
  if (isCount(currentLayer)) print.layer = currentLayer;
  if (isCount(totalLayer) && totalLayer > 0) print.layers = totalLayer;
  return Object.keys(print).length > 0 ? print : undefined;
}

function printStatusOf(frame: SdcpStatusFrame): PrintStatus | undefined {
  const sub = frame.printStatus;
  if (sub === 9) return { state: "done", progress: 1 };
  if (sub === 8) return { state: "canceled", message: "stopped on printer" };
  if (frame.currentStatus.includes(1) || sub === 13) {
    return { state: "printing", progress: frame.progress, print: layersOf(frame) };
  }
  return undefined;
}

function badCountAfter(read: SdcpRead<SdcpPush>, count: number): number {
  if (read.kind === "malformed") return count + 1;
  if (read.kind === "frame" && read.frame.kind === "status") return 0;
  return count;
}

export async function* streamStatus(
  { address, mainboardId, idleTimeoutMs }: StatusStream,
  signal?: AbortSignal,
): AsyncIterable<PrintStatus> {
  const queue: PrintStatus[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  let failure: StageError | null = null;
  let badFrames = 0;
  let printing: PrintStatus | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  const notify = () => {
    wake?.();
    wake = null;
  };
  const stop = () => {
    closed = true;
    notify();
  };
  const fail = (error: StageError) => {
    failure = error;
    stop();
  };
  const restartIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () =>
        fail(
          new StageError(
            "transport",
            `elegoo status from ${address}: no print status for ${idleTimeoutMs} ms`,
          ),
        ),
      idleTimeoutMs,
    );
  };

  const ws = new WebSocket(socketUrl(address));
  const requestStatus = () =>
    ws.send(
      buildCommand(mainboardId, SDCP_CMD.STATUS, {}, randomUUID(), Math.floor(nowMs() / 1000)),
    );
  ws.onopen = () => {
    refreshTimer = setInterval(requestStatus, idleTimeoutMs / 2);
  };
  ws.onmessage = (ev) => {
    const read = parsePushFrame(String(ev.data));
    badFrames = badCountAfter(read, badFrames);
    switch (read.kind) {
      case "other":
        return;
      case "malformed":
        if (badFrames < MAX_BAD_STATUS_FRAMES) return;
        return fail(
          new StageError(
            "transport",
            `elegoo status from ${address}: ${badFrames} unreadable frames since the last status, last: ${read.reason}`,
          ),
        );
      case "frame": {
        const status = toPrintStatus(read.frame, printing);
        if (!status) return;
        if (status.state === "printing") printing = status;
        if (read.frame.kind === "status") restartIdleTimer();
        queue.push(status);
        return notify();
      }
      default:
        return exhaustive(read);
    }
  };
  ws.onclose = stop;
  ws.onerror = stop;
  signal?.addEventListener("abort", stop, { once: true });
  restartIdleTimer();

  try {
    while (!closed && !signal?.aborted) {
      if (queue.length === 0) await new Promise<void>((r) => (wake = r));
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) yield next;
    }
  } finally {
    clearTimeout(idleTimer);
    clearInterval(refreshTimer);
    signal?.removeEventListener("abort", stop);
    ws.close();
  }
  if (failure) throw failure;
}
