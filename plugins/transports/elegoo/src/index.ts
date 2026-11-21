import { createSocket } from "node:dgram";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  type GcodeArtifact,
  type PrinterTarget,
  type PrintHandle,
  PrintNotStartedError,
  type PrintStatus,
  type StageCtx,
  StageError,
  type TransportPlugin,
} from "@conveyor/shared";
import { parseDiscovery, SDCP_CMD, type SdcpDiscovery } from "./sdcp.js";
import { sendCommand, streamStatus, WS_PORT } from "./socket.js";

const STUB = process.env.CONVEYOR_ENGINE_STUB === "1";
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
      return elegooHandle(target, filename);
    }

    const mainboardId = mainboardIdOf(target);
    await uploadGcode(target.address, gcode.path, ctx);

    if (ctx.signal.aborted) throw new PrintNotStartedError("canceled before START_PRINT");
    ctx.log(`elegoo SDCP cmd ${SDCP_CMD.START_PRINT} → ${target.address}`);
    await sendCommand(target.address, {
      mainboardId,
      cmd: SDCP_CMD.START_PRINT,
      data: { Filename: filename, StartLayer: 0 },
    });

    return elegooHandle(target, filename);
  },

  handleFor: elegooHandle,

  async *status(handle: PrintHandle, signal?: AbortSignal): AsyncIterable<PrintStatus> {
    if (STUB) {
      yield { state: "transferring" };
      for (let p = 0; p <= 1.0001; p += 0.25) yield { state: "printing", progress: Math.min(p, 1) };
      yield { state: "done", progress: 1 };
      return;
    }
    if (!handle.address)
      throw new StageError("transport", "elegoo status: missing printer address on handle");

    yield { state: "transferring" };
    for await (const s of streamStatus(handle.address, STATUS_TIMEOUT_MS, signal)) {
      yield s;
      if (s.state === "done" || s.state === "failed" || s.state === "canceled") return;
    }
  },

  async cancel(handle: PrintHandle): Promise<void> {
    if (STUB) return;
    if (!handle.address)
      throw new StageError("transport", "elegoo cancel: missing printer address on handle");
    const mainboardId = handle.deviceId ?? handle.printerId;
    await sendCommand(handle.address, { mainboardId, cmd: SDCP_CMD.STOP_PRINT, data: {} }, true);
  },
};

function mainboardIdOf(target: PrinterTarget): string {
  return target.secrets?.mainboardId ?? target.id;
}

function elegooHandle(target: PrinterTarget, ref: string): PrintHandle {
  return {
    transportId: "elegoo",
    printerId: target.id,
    ref,
    address: target.address,
    deviceId: mainboardIdOf(target),
  };
}

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
      const probe = Buffer.from("M99999");
      sock.send(probe, 0, probe.length, DISCOVERY_PORT, "255.255.255.255");
    });
    setTimeout(() => {
      sock.close();
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

async function uploadGcode(address: string, path: string, ctx: StageCtx): Promise<void> {
  const filename = basename(path);
  const body = await readFile(path);
  const form = new FormData();
  form.append("File", new Blob([body]), filename);
  const url = `http://${address}:${WS_PORT}/uploadFile/upload`;
  const res = await fetch(url, { method: "POST", body: form, signal: ctx.signal }).catch((e) => {
    const reason = `elegoo upload failed: ${e instanceof Error ? e.message : String(e)}`;
    throw ctx.signal.aborted
      ? new PrintNotStartedError(reason)
      : new StageError("transport", reason);
  });
  if (!res.ok)
    throw new StageError(
      "transport",
      `elegoo upload failed: ${res.status} (confirm route — see VERIFY note)`,
    );
}
