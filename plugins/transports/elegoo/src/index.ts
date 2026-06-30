import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createSocket } from "node:dgram";
import { randomUUID } from "node:crypto";
import {
  StageError,
  type GcodeArtifact,
  type PrintHandle,
  type PrinterTarget,
  type PrintStatus,
  type StageCtx,
  type TransportPlugin,
} from "@conveyor/shared";
import {
  SDCP_CMD,
  buildCommand,
  parseDiscovery,
  parseStatusFrame,
  type SdcpDiscovery,
} from "./sdcp.js";

/**
 * ElegooLink / SDCP transport. Elegoo printers speak SDCP (UDP discovery +
 * WebSocket control on :3030 + HTTP file upload) on the LAN.
 *
 * ── VERIFY-ON-HARDWARE (written 2026-06-29 from the SDCP V3.0.0 spec, not yet
 *    run against a printer). The two things the spike must confirm:
 *      1. FILE UPLOAD route + chunking. SDCP's file transfer differs across
 *         firmware (resin vs FDM); the published spec is light here. This adapter
 *         implements the common `POST http://<ip>:3030/uploadFile/upload`
 *         multipart form — CONFIRM against your printer (capture ElegooLink's
 *         traffic) and adjust uploadGcode() if it 404s.
 *      2. START_PRINT payload — whether it takes {Filename, StartLayer} as below
 *         or a file path/token returned by the upload step.
 *    Discovery + the status enum mapping follow the spec directly. See
 *    docs/M2-TRANSPORTS.md for the capture-and-confirm runbook.
 */
const STUB = process.env.CONVEYOR_ENGINE_STUB === "1";
const WS_PORT = Number(process.env.ELEGOO_WS_PORT ?? 3030);
const DISCOVERY_PORT = Number(process.env.ELEGOO_DISCOVERY_PORT ?? 3000);
const DISCOVERY_MS = Number(process.env.ELEGOO_DISCOVERY_MS ?? 3000);
const STATUS_TIMEOUT_MS = Number(process.env.ELEGOO_STATUS_TIMEOUT_MS ?? 10 * 60 * 1000);

export const elegoo: TransportPlugin = {
  id: "elegoo",
  name: "ElegooLink",
  version: "0.1.0",
  stage: "transport",
  acceptsFlavors: ["klipper", "marlin"],

  async discover(): Promise<PrinterTarget[]> {
    if (STUB) return [];
    const found = await discoverSdcp(DISCOVERY_MS);
    return found.map((d) => ({
      id: d.mainboardId,
      transportId: "elegoo",
      address: d.mainboardIp,
      secrets: {},
    }));
  },

  async submit(gcode: GcodeArtifact, target: PrinterTarget, ctx: StageCtx): Promise<PrintHandle> {
    const filename = basename(gcode.path);
    if (STUB) {
      ctx.log(`[stub] elegoo upload ${gcode.path} → ${target.address}`);
      return { transportId: "elegoo", printerId: target.id, ref: filename, address: target.address };
    }

    const mainboardId = target.secrets?.mainboardId ?? target.id;
    // 1) upload the gcode over HTTP (see VERIFY note #1).
    await uploadGcode(target.address, gcode.path, filename, ctx);

    // 2) issue START_PRINT over the control WebSocket.
    await sendCommand(target.address, mainboardId, SDCP_CMD.START_PRINT, { Filename: filename, StartLayer: 0 }, ctx);

    return { transportId: "elegoo", printerId: target.id, ref: filename, address: target.address, };
  },

  async *status(handle: PrintHandle): AsyncIterable<PrintStatus> {
    if (STUB) {
      yield { state: "transferring" };
      for (let p = 0; p <= 1.0001; p += 0.25) yield { state: "printing", progress: Math.min(p, 1) };
      yield { state: "done", progress: 1 };
      return;
    }
    if (!handle.address) throw new StageError("transport", "elegoo status: missing printer address on handle");

    yield { state: "transferring" };
    // Drain pushed status frames from the WS, translating to PrintStatus until terminal.
    for await (const s of streamStatus(handle.address, STATUS_TIMEOUT_MS)) {
      yield s;
      if (s.state === "done" || s.state === "failed" || s.state === "canceled") return;
    }
  },

  async cancel(handle: PrintHandle): Promise<void> {
    if (STUB) return;
    if (!handle.address) throw new StageError("transport", "elegoo cancel: missing printer address on handle");
    const mainboardId = handle.printerId;
    await sendCommandRaw(handle.address, mainboardId, SDCP_CMD.STOP_PRINT, {});
  },
};

// ─── SDCP discovery (UDP broadcast) ──────────────────────────────────────────

function discoverSdcp(timeoutMs: number): Promise<SdcpDiscovery[]> {
  return new Promise((resolve, reject) => {
    const sock = createSocket("udp4");
    const found = new Map<string, SdcpDiscovery>();
    sock.on("error", (e) => {
      sock.close();
      reject(new StageError("transport", `elegoo discovery socket error: ${e.message}`));
    });
    sock.on("message", (msg) => {
      const d = parseDiscovery(msg.toString());
      if (d) found.set(d.mainboardId, d);
    });
    sock.bind(() => {
      sock.setBroadcast(true);
      // "M99999" is the SDCP discovery probe.
      const probe = Buffer.from("M99999");
      sock.send(probe, 0, probe.length, DISCOVERY_PORT, "255.255.255.255");
    });
    setTimeout(() => {
      sock.close();
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

// ─── SDCP control (WebSocket) ────────────────────────────────────────────────

/** Open the device WS, send one command, await its ack, then close. */
function sendCommand(
  address: string,
  mainboardId: string,
  cmd: number,
  data: Record<string, unknown>,
  ctx: StageCtx,
): Promise<void> {
  ctx.log(`elegoo SDCP cmd ${cmd} → ${address}`);
  return sendCommandRaw(address, mainboardId, cmd, data);
}

function sendCommandRaw(
  address: string,
  mainboardId: string,
  cmd: number,
  data: Record<string, unknown>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${address}:${WS_PORT}/websocket`);
    const requestId = randomUUID();
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* noop */
      }
      err ? reject(err) : resolve();
    };
    const timer = setTimeout(() => done(new StageError("transport", `elegoo cmd ${cmd} timed out`)), 15000);
    ws.onopen = () => {
      // TimeStamp is wall-clock seconds; supplied via the runtime, not at import.
      ws.send(buildCommand(mainboardId, cmd, data, requestId, Math.floor(nowMs() / 1000)));
    };
    ws.onmessage = (ev) => {
      try {
        const j = JSON.parse(String(ev.data));
        const ackId = j?.Data?.RequestID ?? j?.Data?.Data?.RequestID;
        if (ackId === requestId) {
          clearTimeout(timer);
          const code = j?.Data?.Data?.Ack ?? j?.Data?.Ack ?? 0;
          done(code === 0 ? undefined : new StageError("transport", `elegoo cmd ${cmd} rejected (ack ${code})`));
        }
      } catch {
        /* ignore non-JSON frames */
      }
    };
    ws.onerror = () => done(new StageError("transport", `elegoo WS error to ${address}:${WS_PORT}`));
    ws.onclose = () => done(); // resolve if closed after ack
  });
}

/** Subscribe to pushed status frames, translating each to a PrintStatus. */
async function* streamStatus(address: string, timeoutMs: number): AsyncIterable<PrintStatus> {
  const queue: PrintStatus[] = [];
  let resolveNext: (() => void) | null = null;
  let closed = false;

  const ws = new WebSocket(`ws://${address}:${WS_PORT}/websocket`);
  const push = (s: PrintStatus) => {
    queue.push(s);
    resolveNext?.();
    resolveNext = null;
  };

  ws.onmessage = (ev) => {
    const frame = parseStatusFrame(String(ev.data));
    if (!frame) return;
    // CurrentStatus: 0 idle, 1 printing, 2 file-transferring. PrintInfo.Status enum
    // gives the fine sub-state (9 = complete, 8 = stopped, 6 = paused).
    const sub = frame.printStatus;
    if (sub === 9) push({ state: "done", progress: 1 });
    else if (sub === 8) push({ state: "canceled", message: "stopped on printer" });
    else if (frame.currentStatus.includes(1) || sub === 13)
      push({ state: "printing", progress: frame.progress });
    // idle/other → no emission (keeps the stepper on its prior state)
  };
  ws.onclose = () => {
    closed = true;
    resolveNext?.();
  };
  ws.onerror = () => {
    closed = true;
    resolveNext?.();
  };

  const deadline = nowMs() + timeoutMs;
  while (!closed && nowMs() < deadline) {
    if (queue.length === 0) await new Promise<void>((r) => (resolveNext = r));
    while (queue.length) yield queue.shift()!;
  }
  try {
    ws.close();
  } catch {
    /* noop */
  }
}

// ─── HTTP file upload (VERIFY note #1) ───────────────────────────────────────

async function uploadGcode(address: string, path: string, filename: string, ctx: StageCtx): Promise<void> {
  const body = await readFile(path);
  const form = new FormData();
  form.append("File", new Blob([body]), filename);
  // Common SDCP upload route — CONFIRM on hardware (resin vs FDM differ).
  const url = `http://${address}:${WS_PORT}/uploadFile/upload`;
  const res = await fetch(url, { method: "POST", body: form, signal: ctx.signal }).catch((e) => {
    throw new StageError("transport", `elegoo upload failed: ${(e as Error).message}`);
  });
  if (!res.ok) throw new StageError("transport", `elegoo upload failed: ${res.status} (confirm route — see VERIFY note)`);
}

/** Date.now via a tiny indirection so the import graph stays pure. */
function nowMs(): number {
  return Date.now();
}
