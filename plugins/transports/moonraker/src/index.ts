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
import { formatHostPort, parseHostPort } from "@conveyor/shared/address";

const STUB = process.env.CONVEYOR_ENGINE_STUB === "1";
const POLL_MS = Number(process.env.MOONRAKER_POLL_MS ?? 2000);
const CANCEL_TIMEOUT_MS = 15000;

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
      return {
        transportId: "moonraker",
        printerId: target.id,
        ref: filename,
        address: target.address,
      };
    }

    const base = baseUrl(target.address);
    const body = await readFile(gcode.path);
    const headers = apiKeyHeaders(target);

    const form = new FormData();
    form.append("file", new Blob([body]), filename);
    const up = await fetch(`${base}/server/files/upload`, {
      method: "POST",
      body: form,
      headers,
      signal: ctx.signal,
    }).catch((e) => {
      const reason = `moonraker upload failed: ${e instanceof Error ? e.message : String(e)}`;
      throw ctx.signal.aborted
        ? new PrintNotStartedError(reason)
        : new StageError("transport", reason);
    });
    if (!up.ok) throw new StageError("transport", `moonraker upload failed: ${up.status}`);
    if (ctx.signal.aborted) throw new PrintNotStartedError("canceled before print start");

    const start = await fetch(
      `${base}/printer/print/start?filename=${encodeURIComponent(filename)}`,
      {
        method: "POST",
        headers,
        signal: ctx.signal,
      },
    );
    if (!start.ok) throw new StageError("transport", `moonraker start failed: ${start.status}`);

    return {
      transportId: "moonraker",
      printerId: target.id,
      ref: filename,
      address: target.address,
    };
  },

  async *status(handle: PrintHandle, signal?: AbortSignal): AsyncIterable<PrintStatus> {
    if (STUB) {
      yield { state: "transferring" };
      for (let p = 0; p <= 1.0001; p += 0.25) yield { state: "printing", progress: Math.min(p, 1) };
      yield { state: "done", progress: 1 };
      return;
    }

    if (!handle.address)
      throw new StageError("transport", "moonraker status: missing printer address on handle");
    const base = baseUrl(handle.address);
    const query = `${base}/printer/objects/query?print_stats&virtual_sdcard&display_status`;

    yield { state: "transferring" };
    let printingSeen = false;
    while (true) {
      const res = await fetch(query, { headers: keyHeaderFromEnv(), signal }).catch((e) => {
        throw new StageError("transport", `moonraker status query failed: ${(e as Error).message}`);
      });
      if (!res.ok)
        throw new StageError("transport", `moonraker status query failed: ${res.status}`);

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
          if (printingSeen && progress >= 0.999) {
            yield { state: "done", progress: 1 };
            return;
          }
          break;
        default:
          break;
      }
      await sleep(POLL_MS, signal);
    }
  },

  async cancel(handle: PrintHandle): Promise<void> {
    if (STUB) return;
    if (!handle.address)
      throw new StageError("transport", "moonraker cancel: missing printer address on handle");
    const base = baseUrl(handle.address);
    const res = await fetch(`${base}/printer/print/cancel`, {
      method: "POST",
      headers: keyHeaderFromEnv(),
      signal: AbortSignal.timeout(CANCEL_TIMEOUT_MS),
    });
    if (!res.ok) throw new StageError("transport", `moonraker cancel failed: ${res.status}`);
  },
};

function baseUrl(address: string): string {
  if (address.startsWith("http://") || address.startsWith("https://"))
    return address.replace(/\/$/, "");
  const parsed = parseHostPort(address, 80);
  if (parsed.kind === "invalid")
    throw new StageError("transport", `moonraker printer address ${parsed.reason}`);
  return `http://${formatHostPort(parsed.host, parsed.port)}`;
}

function apiKeyHeaders(target: PrinterTarget): Record<string, string> {
  const key = target.secrets?.apiKey ?? target.secrets?.moonrakerApiKey;
  return key ? { "X-Api-Key": key } : {};
}
function keyHeaderFromEnv(): Record<string, string> {
  const key = process.env.MOONRAKER_API_KEY;
  return key ? { "X-Api-Key": key } : {};
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new StageError("transport", "moonraker status aborted"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new StageError("transport", "moonraker status aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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
