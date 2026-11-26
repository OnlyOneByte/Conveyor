import {
  type GcodeArtifact,
  type PrinterTarget,
  type PrintHandle,
  PrintMayHaveStartedError,
  PrintNotStartedError,
  type PrintStatus,
  printerFileName,
  refuseUnlessIdle,
  type StageCtx,
  StageError,
  type TransportPlugin,
} from "@conveyor/shared";
import { formatHostPort, parseHostPort } from "@conveyor/shared/address";
import {
  multipartFileUpload,
  refuseRedirect,
  requirePrinterAddress,
  uploadSignal,
} from "@conveyor/shared/node";
import { poll, positiveSetting, unresolved } from "./poll.ts";
import { pruneGcodes } from "./prune.ts";
import { parseQuery, printProgressOf } from "./query.ts";
import { moonrakerReadiness } from "./ready.ts";

const STUB = process.env.CONVEYOR_ENGINE_STUB === "1";
const POLL_MS = 2000;
const CANCEL_TIMEOUT_MS = 15000;
const STATUS_TIMEOUT_MS = 30000;
const START_TIMEOUT_MS = 30000;
const STATUS_FAILURES = 5;

export const moonraker: TransportPlugin = {
  id: "moonraker",
  name: "Klipper / Moonraker",
  version: "0.1.0",
  stage: "transport",
  acceptsFlavors: ["klipper", "marlin"],

  async submit(gcode: GcodeArtifact, target: PrinterTarget, ctx: StageCtx): Promise<PrintHandle> {
    const filename = printerFileName(ctx.jobId);
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
    await requirePrinterAddress(target.address);
    const headers = apiKeyHeaders(target);
    const readyMs = positiveSetting("MOONRAKER_STATUS_TIMEOUT_MS", STATUS_TIMEOUT_MS);
    refuseUnlessIdle("moonraker", await moonrakerReadiness(base, headers, readyMs, ctx.signal));

    const upload = multipartFileUpload(
      { field: "file", path: gcode.path, filename },
      (sent, total) => ctx.reportUpload?.(sent, total),
    );
    const up = await fetch(`${base}/server/files/upload`, {
      method: "POST",
      body: upload.body,
      headers: { ...headers, ...upload.headers },
      redirect: "manual",
      signal: uploadSignal(ctx.signal),
    }).catch((e) => {
      const reason = `moonraker upload failed: ${e instanceof Error ? e.message : String(e)}`;
      throw ctx.signal.aborted
        ? new PrintNotStartedError(reason)
        : new StageError("transport", reason);
    });
    refuseRedirect(up, "moonraker upload");
    if (!up.ok) throw new StageError("transport", `moonraker upload failed: ${up.status}`);
    if (ctx.signal.aborted) throw new PrintNotStartedError("canceled before print start");
    await ctx.confirmStart?.();

    const startMs = positiveSetting("MOONRAKER_START_TIMEOUT_MS", START_TIMEOUT_MS);
    const start = await fetch(
      `${base}/printer/print/start?filename=${encodeURIComponent(filename)}`,
      {
        method: "POST",
        headers,
        redirect: "manual",
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(startMs)]),
      },
    ).catch((e) => {
      if (ctx.signal.aborted) throw e;
      const timedOut = e instanceof Error && e.name === "TimeoutError";
      throw new PrintMayHaveStartedError(
        timedOut
          ? `moonraker gave no answer to print start within ${startMs} ms`
          : `moonraker start failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    });
    refuseRedirect(start, "moonraker start");
    if (!start.ok) throw new StageError("transport", `moonraker start failed: ${start.status}`);

    return {
      transportId: "moonraker",
      printerId: target.id,
      ref: filename,
      address: target.address,
    };
  },

  async *status(
    handle: PrintHandle,
    signal?: AbortSignal,
    target?: PrinterTarget,
  ): AsyncIterable<PrintStatus> {
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
    const headers = statusKeyHeaders(target);
    const timeoutMs = positiveSetting("MOONRAKER_STATUS_TIMEOUT_MS", STATUS_TIMEOUT_MS);
    const failuresAllowed = positiveSetting("MOONRAKER_STATUS_FAILURES", STATUS_FAILURES);
    const pollMs = positiveSetting("MOONRAKER_POLL_MS", POLL_MS);

    yield { state: "transferring" };
    let printingSeen = false;
    let failures = 0;
    while (true) {
      const res =
        (await unresolved(handle.address)) ?? (await poll(query, headers, timeoutMs, signal));
      if (typeof res === "string") {
        failures++;
        if (failures >= failuresAllowed || signal?.aborted)
          throw new StageError(
            "transport",
            `moonraker status query failed: ${res} (${failures} in a row)`,
          );
        await sleep(pollMs, signal);
        continue;
      }
      failures = 0;

      const objects = parseQuery(await res.json());
      const ps = objects.print_stats;
      const state = ps?.state ?? "standby";
      const progress = clamp01(
        objects.display_status?.progress ?? objects.virtual_sdcard?.progress ?? 0,
      );
      const print = printProgressOf(objects);

      switch (state) {
        case "printing":
          printingSeen = true;
          yield { state: "printing", progress, message: ps?.message, print };
          break;
        case "paused":
          yield { state: "printing", progress, message: "paused", print };
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
      await sleep(pollMs, signal);
    }
  },

  async cancel(handle: PrintHandle, target?: PrinterTarget): Promise<void> {
    if (STUB) return;
    if (!handle.address)
      throw new StageError("transport", "moonraker cancel: missing printer address on handle");
    const base = baseUrl(handle.address);
    await requirePrinterAddress(handle.address);
    const res = await fetch(`${base}/printer/print/cancel`, {
      method: "POST",
      headers: statusKeyHeaders(target),
      redirect: "manual",
      signal: AbortSignal.timeout(CANCEL_TIMEOUT_MS),
    });
    refuseRedirect(res, "moonraker cancel");
    if (!res.ok) throw new StageError("transport", `moonraker cancel failed: ${res.status}`);
  },

  async pruneFiles(target, keep, signal) {
    if (STUB) return [];
    await requirePrinterAddress(target.address);
    const timeoutMs = positiveSetting("MOONRAKER_STATUS_TIMEOUT_MS", STATUS_TIMEOUT_MS);
    return pruneGcodes(baseUrl(target.address), apiKeyHeaders(target), keep, timeoutMs, signal);
  },
};

function baseUrl(address: string): string {
  if (/^https?:\/\//i.test(address)) return address.replace(/\/$/, "");
  const bare = address.replace(/^\/\//, "");
  const slash = bare.indexOf("/");
  const authority = slash === -1 ? bare : bare.slice(0, slash);
  const path = slash === -1 ? "" : bare.slice(slash).replace(/\/$/, "");
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  const parsed = parseHostPort(host, 80, address);
  if (parsed.kind === "invalid")
    throw new StageError("transport", `moonraker printer address ${parsed.reason}`);
  return `http://${formatHostPort(parsed.host, parsed.port)}${path}`;
}

function apiKeyHeaders(target: PrinterTarget): Record<string, string> {
  const key = target.secrets?.apiKey ?? target.secrets?.moonrakerApiKey;
  return key ? { "X-Api-Key": key } : {};
}
function statusKeyHeaders(target?: PrinterTarget): Record<string, string> {
  const printerKey = target ? apiKeyHeaders(target) : {};
  if (printerKey["X-Api-Key"]) return printerKey;
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
