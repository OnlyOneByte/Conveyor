import { randomUUID } from "node:crypto";
import { type PrintStatus, StageError } from "@conveyor/shared";
import { formatHostPort, hostPortOf, parseHostPort } from "@conveyor/shared/address";
import { AckFrame, decodeFrame, ReplyFrame } from "./frames.js";
import { toPrintStatus } from "./print-status.js";
import {
  buildCommand,
  exhaustive,
  parsePushFrame,
  SDCP_CMD,
  type SdcpPush,
  type SdcpRead,
} from "./sdcp.js";

export const WS_PORT = Number(process.env.ELEGOO_WS_PORT ?? 3030);
const COMMAND_TIMEOUT_MS = 15000;
export const MAX_BAD_STATUS_FRAMES = 3;

interface StatusStream {
  address: string;
  mainboardId: string;
  idleTimeoutMs: number;
  filename?: string;
  priorTask?: string;
}

export class SdcpRejectedError extends StageError {
  constructor(message: string) {
    super("transport", message);
  }
}

interface SdcpCommand {
  mainboardId: string;
  cmd: number;
  data: Record<string, unknown>;
}

export function printerEndpoint(address: string): string {
  const hostPort = hostPortOf(address);
  const parsed = parseHostPort(hostPort, WS_PORT, hostPort === address ? undefined : address);
  if (parsed.kind === "invalid")
    throw new StageError("transport", `elegoo printer address ${parsed.reason}`);
  return formatHostPort(parsed.host, parsed.port);
}

export function socketUrl(address: string): string {
  return `ws://${printerEndpoint(address)}/websocket`;
}

function nowMs(): number {
  return Date.now();
}

export function ackCode(raw: string, requestId: string): SdcpRead<number> {
  const decoded = decodeFrame(AckFrame, raw);
  if (decoded.kind === "malformed" && !raw.includes(requestId))
    return { kind: "other", reason: decoded.reason };
  if (decoded.kind === "malformed") return decoded;
  const data = decoded.value.Data;
  const ackId = data?.RequestID ?? data?.Data?.RequestID;
  if (ackId !== requestId) return { kind: "other", reason: "not an ack for this request" };
  return { kind: "frame", frame: data?.Data?.Ack ?? data?.Ack ?? 0 };
}

function replyData(raw: string): unknown {
  const decoded = decodeFrame(ReplyFrame, raw);
  return decoded.kind === "decoded" ? decoded.value.Data?.Data : undefined;
}

export function sendCommand(
  address: string,
  { mainboardId, cmd, data }: SdcpCommand,
  requireAck = false,
  onSent?: () => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl(address));
    const requestId = randomUUID();
    let settled = false;
    const done = (err?: Error, reply?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      if (err) reject(err);
      else resolve(reply);
    };
    const timer = setTimeout(
      () => done(new StageError("transport", `elegoo cmd ${cmd} timed out`)),
      COMMAND_TIMEOUT_MS,
    );
    ws.onopen = () => {
      ws.send(buildCommand(mainboardId, cmd, data, requestId, Math.floor(nowMs() / 1000)));
      onSent?.();
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
          return reply.frame === 0
            ? done(undefined, replyData(String(ev.data)))
            : done(new SdcpRejectedError(`elegoo cmd ${cmd} rejected (ack ${reply.frame})`));
        default:
          return exhaustive(reply);
      }
    };
    ws.onerror = () =>
      done(new StageError("transport", `elegoo WS error to ${printerEndpoint(address)}`));
    ws.onclose = () =>
      done(
        requireAck
          ? new StageError("transport", `elegoo cmd ${cmd}: socket closed before the printer acked`)
          : undefined,
      );
  });
}

function badCountAfter(read: SdcpRead<SdcpPush>, count: number): number {
  if (read.kind === "malformed") return count + 1;
  if (read.kind === "frame" && read.frame.kind === "status") return 0;
  return count;
}

export async function* streamStatus(
  { address, mainboardId, idleTimeoutMs, filename, priorTask }: StatusStream,
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
        const status = toPrintStatus(read.frame, { filename, priorTask, printing });
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
