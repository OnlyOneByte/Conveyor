import { randomUUID } from "node:crypto";
import { type PrinterReadiness, PrintNotStartedError } from "@conveyor/shared";
import { buildCommand, parsePushFrame, SDCP_CMD, type SdcpStatusFrame } from "./sdcp.js";
import { socketUrl } from "./socket.js";

export const READY_TIMEOUT_MS = 15000;

const PAUSED = new Set([5, 6]);
const SETTLED = new Set([0, 8, 9]);

export function elegooState(status: SdcpStatusFrame): PrinterReadiness {
  if (status.printStatus !== null && PAUSED.has(status.printStatus)) return "paused";
  const active = status.currentStatus.some((code) => code !== 0);
  const settled = status.printStatus === null || SETTLED.has(status.printStatus);
  return !active && settled ? "idle" : "printing";
}

export function elegooReadiness(
  address: string,
  mainboardId: string,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<PrinterReadiness> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl(address));
    const finish = () => {
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
      resolve(read.frame.kind === "error" ? "error" : elegooState(read.frame.status));
    };
    ws.onerror = () => fail("socket error");
    ws.onclose = () => fail("socket closed before a status arrived");
  });
}
