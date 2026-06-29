import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  StageError,
  type GcodeArtifact,
  type PrintHandle,
  type PrinterTarget,
  type PrintStatus,
  type StageCtx,
  type TransportPlugin,
} from "@conveyor/shared";

/**
 * Klipper via the Moonraker HTTP API: upload the gcode, start the print, then
 * poll printer objects for progress. Well-documented, LAN-friendly — our
 * lowest-risk transport.
 */
const STUB = process.env.CONVEYOR_ENGINE_STUB === "1";
const POLL_MS = Number(process.env.MOONRAKER_POLL_MS ?? 2000);

export const moonraker: TransportPlugin = {
  id: "moonraker",
  name: "Klipper / Moonraker",
  version: "0.1.0",
  stage: "transport",
  acceptsFlavors: ["klipper", "marlin"],

  async submit(gcode: GcodeArtifact, target: PrinterTarget, ctx: StageCtx): Promise<PrintHandle> {
    const filename = basename(gcode.path);
    if (STUB) {
      ctx.log(`[stub] upload ${filename} → ${target.address} and start`);
      return { transportId: "moonraker", printerId: target.id, ref: filename };
    }

    const base = `http://${target.address}`;
    const body = await readFile(gcode.path);

    // 1) upload to the virtual sdcard
    const form = new FormData();
    form.append("file", new Blob([body]), filename);
    const up = await fetch(`${base}/server/files/upload`, { method: "POST", body: form, signal: ctx.signal });
    if (!up.ok) throw new StageError("transport", `moonraker upload failed: ${up.status}`);

    // 2) start the print
    const start = await fetch(`${base}/printer/print/start?filename=${encodeURIComponent(filename)}`, {
      method: "POST",
      signal: ctx.signal,
    });
    if (!start.ok) throw new StageError("transport", `moonraker start failed: ${start.status}`);

    return { transportId: "moonraker", printerId: target.id, ref: filename };
  },

  async *status(handle: PrintHandle): AsyncIterable<PrintStatus> {
    if (STUB) {
      yield { state: "transferring" };
      for (let p = 0; p <= 1.0001; p += 0.25) yield { state: "printing", progress: Math.min(p, 1) };
      yield { state: "done", progress: 1 };
      return;
    }
    // Real impl (M2): poll /printer/objects/query?print_stats&virtual_sdcard until
    // print_stats.state ∈ {complete, error, cancelled}, mapping progress through.
    throw new StageError("transport", "moonraker live status not implemented (M2)");
  },

  async cancel(handle: PrintHandle): Promise<void> {
    if (STUB) return;
    throw new StageError("transport", "moonraker cancel not implemented (M2)");
  },
};

void POLL_MS;
