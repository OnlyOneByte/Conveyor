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
 *
 * ── VERIFY-ON-HARDWARE (written 2026-06-29, not yet run against a real printer) ──
 * Endpoints used (Moonraker docs):
 *   POST /server/files/upload                      (multipart "file")
 *   POST /printer/print/start?filename=<name>
 *   GET  /printer/objects/query?print_stats&virtual_sdcard&display_status
 *   POST /printer/print/cancel
 * To test: set a Station's printer address to your Moonraker host (e.g.
 * "192.168.1.50:7125"), unset CONVEYOR_ENGINE_STUB, submit a job, watch the WS
 * stepper. If your instance requires auth, set MOONRAKER_API_KEY (or store
 * printer.secrets.apiKey) — otherwise add the worker host to Moonraker's
 * trusted_clients. See docs/M2-TRANSPORTS.md.
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
      return { transportId: "moonraker", printerId: target.id, ref: filename, address: target.address };
    }

    const base = baseUrl(target.address);
    const body = await readFile(gcode.path);
    const headers = apiKeyHeaders(target);

    // 1) upload to the virtual sdcard
    const form = new FormData();
    form.append("file", new Blob([body]), filename);
    const up = await fetch(`${base}/server/files/upload`, {
      method: "POST",
      body: form,
      headers,
      signal: ctx.signal,
    });
    if (!up.ok) throw new StageError("transport", `moonraker upload failed: ${up.status}`);

    // 2) start the print
    const start = await fetch(`${base}/printer/print/start?filename=${encodeURIComponent(filename)}`, {
      method: "POST",
      headers,
      signal: ctx.signal,
    });
    if (!start.ok) throw new StageError("transport", `moonraker start failed: ${start.status}`);

    // Carry address forward so status()/cancel() can reach the printer.
    return { transportId: "moonraker", printerId: target.id, ref: filename, address: target.address };
  },

  async *status(handle: PrintHandle): AsyncIterable<PrintStatus> {
    if (STUB) {
      yield { state: "transferring" };
      for (let p = 0; p <= 1.0001; p += 0.25) yield { state: "printing", progress: Math.min(p, 1) };
      yield { state: "done", progress: 1 };
      return;
    }

    if (!handle.address) throw new StageError("transport", "moonraker status: missing printer address on handle");
    const base = baseUrl(handle.address);
    const query = `${base}/printer/objects/query?print_stats&virtual_sdcard&display_status`;

    // Poll print_stats.state until terminal. Klipper states:
    //   standby | printing | paused | complete | cancelled | error
    // progress: prefer display_status.progress, fall back to virtual_sdcard.progress (0..1).
    yield { state: "transferring" };
    let printingSeen = false;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await fetch(query, { headers: keyHeaderFromEnv() }).catch((e) => {
        throw new StageError("transport", `moonraker status query failed: ${(e as Error).message}`);
      });
      if (!res.ok) throw new StageError("transport", `moonraker status query failed: ${res.status}`);

      const json = (await res.json()) as MoonrakerQueryResponse;
      const ps = json.result?.status?.print_stats;
      const vsd = json.result?.status?.virtual_sdcard;
      const disp = json.result?.status?.display_status;
      const state = ps?.state ?? "standby";
      const progress = clamp01(disp?.progress ?? vsd?.progress ?? 0);

      switch (state) {
        case "printing":
          printingSeen = true;
          yield { state: "printing", progress, message: ps?.message };
          break;
        case "paused":
          yield { state: "printing", progress, message: "paused" };
          break;
        case "complete":
          yield { state: "done", progress: 1 };
          return;
        case "cancelled":
          yield { state: "canceled", message: "print cancelled on printer" };
          return;
        case "error":
          yield { state: "failed", message: ps?.message ?? "printer reported an error" };
          return;
        case "standby":
          // After a print finishes Klipper can briefly report standby; if we've
          // already seen printing and progress hit ~1, treat it as done.
          if (printingSeen && progress >= 0.999) {
            yield { state: "done", progress: 1 };
            return;
          }
          break;
        default:
          break;
      }
      await sleep(POLL_MS);
    }
  },

  async cancel(handle: PrintHandle): Promise<void> {
    if (STUB) return;
    if (!handle.address) throw new StageError("transport", "moonraker cancel: missing printer address on handle");
    const base = baseUrl(handle.address);
    const res = await fetch(`${base}/printer/print/cancel`, { method: "POST", headers: keyHeaderFromEnv() });
    if (!res.ok) throw new StageError("transport", `moonraker cancel failed: ${res.status}`);
  },
};

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Accept "host", "host:port", or a full URL; default to http. */
function baseUrl(address: string): string {
  if (address.startsWith("http://") || address.startsWith("https://")) return address.replace(/\/$/, "");
  return `http://${address}`;
}

/** Moonraker supports an API key via the X-Api-Key header (or a trusted-client IP). */
function apiKeyHeaders(target: PrinterTarget): Record<string, string> {
  const key = target.secrets?.apiKey ?? target.secrets?.moonrakerApiKey;
  return key ? { "X-Api-Key": key } : {};
}
/** status()/cancel() only receive the handle, so the key (if any) comes from env. */
function keyHeaderFromEnv(): Record<string, string> {
  const key = process.env.MOONRAKER_API_KEY;
  return key ? { "X-Api-Key": key } : {};
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface MoonrakerQueryResponse {
  result?: {
    status?: {
      print_stats?: { state?: string; message?: string };
      virtual_sdcard?: { progress?: number };
      display_status?: { progress?: number };
    };
  };
}
