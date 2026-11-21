import { randomUUID } from "node:crypto";
import { type PrintStatus, StageError } from "@conveyor/shared";
import { buildCommand, parseStatusFrame, type SdcpStatusFrame } from "./sdcp.js";

export const WS_PORT = Number(process.env.ELEGOO_WS_PORT ?? 3030);
const COMMAND_TIMEOUT_MS = 15000;

export interface SdcpCommand {
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

export function ackCode(raw: string, requestId: string): number | undefined {
  try {
    const j = JSON.parse(raw);
    const ackId = j?.Data?.RequestID ?? j?.Data?.Data?.RequestID;
    if (ackId !== requestId) return undefined;
    return j?.Data?.Data?.Ack ?? j?.Data?.Ack ?? 0;
  } catch {
    return undefined;
  }
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
      const code = ackCode(String(ev.data), requestId);
      if (code === undefined) return;
      done(
        code === 0
          ? undefined
          : new StageError("transport", `elegoo cmd ${cmd} rejected (ack ${code})`),
      );
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

export function toPrintStatus(frame: SdcpStatusFrame): PrintStatus | undefined {
  const sub = frame.printStatus;
  if (sub === 9) return { state: "done", progress: 1 };
  if (sub === 8) return { state: "canceled", message: "stopped on printer" };
  if (frame.currentStatus.includes(1) || sub === 13) {
    return { state: "printing", progress: frame.progress };
  }
  return undefined;
}

export async function* streamStatus(
  address: string,
  timeoutMs: number,
  signal?: AbortSignal,
): AsyncIterable<PrintStatus> {
  const queue: PrintStatus[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const notify = () => {
    wake?.();
    wake = null;
  };
  const stop = () => {
    closed = true;
    notify();
  };

  const ws = new WebSocket(socketUrl(address));
  ws.onmessage = (ev) => {
    const frame = parseStatusFrame(String(ev.data));
    const status = frame ? toPrintStatus(frame) : undefined;
    if (!status) return;
    queue.push(status);
    notify();
  };
  ws.onclose = stop;
  ws.onerror = stop;
  signal?.addEventListener("abort", stop, { once: true });

  const deadline = nowMs() + timeoutMs;
  while (!closed && !signal?.aborted && nowMs() < deadline) {
    if (queue.length === 0) await new Promise<void>((r) => (wake = r));
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) yield next;
  }
  ws.close();
}
