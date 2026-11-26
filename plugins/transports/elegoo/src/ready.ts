import { randomUUID } from "node:crypto";
import { type PrinterReadiness, PrintNotStartedError } from "@conveyor/shared";
import {
  buildCommand,
  parsePushFrame,
  SDCP_CMD,
  type SdcpPush,
  type SdcpStatusFrame,
} from "./sdcp.js";
import { socketUrl } from "./socket.js";

export const READY_TIMEOUT_MS = 15000;

const PAUSED = new Set([5, 6]);
const SETTLED = new Set([0, 8, 9]);

export function elegooState(status: SdcpStatusFrame): PrinterReadiness {
  if (status.currentStatus.length === 0 || status.printStatus === null) return "unknown";
  if (PAUSED.has(status.printStatus)) return "paused";
  const active = status.currentStatus.some((code) => code !== 0);
  return !active && SETTLED.has(status.printStatus) ? "idle" : "printing";
}

export async function elegooReadiness(
  address: string,
  mainboardId: string,
  timeoutMs = READY_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<PrinterReadiness> {
  const push = await elegooStatusOnce(address, mainboardId, timeoutMs, signal);
  return push.kind === "error" ? "error" : elegooState(push.status);
}

export function elegooStatusOnce(
  address: string,
  mainboardId: string,
  timeoutMs = READY_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<SdcpPush> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new PrintNotStartedError("canceled before upload"));
    const ws = new WebSocket(socketUrl(address));
    const onAbort = () => {
      finish();
      reject(new PrintNotStartedError("canceled before upload"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      clearTimeout(timer);
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      ws.close();
    };
    const fail = (why: string) => {
      finish();
      reject(new PrintNotStartedError(`elegoo idle check from ${address}: ${why}`));
    };
    const timer = setTimeout(() => fail(`no status within ${timeoutMs} ms`), timeoutMs);
    ws.onopen = () =>
      ws.send(
        buildCommand(mainboardId, SDCP_CMD.STATUS, {}, randomUUID(), Math.floor(Date.now() / 1000)),
      );
    ws.onmessage = (ev) => {
      const read = parsePushFrame(String(ev.data));
      if (read.kind !== "frame") return;
      finish();
      resolve(read.frame);
    };
    ws.onerror = () => fail("socket error");
    ws.onclose = () => fail("socket closed before a status arrived");
  });
}
