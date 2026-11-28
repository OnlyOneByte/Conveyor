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
import { addressParts, formatHostPort, parseHostPort } from "@conveyor/shared/address";
import { multipartFileUpload, refuseRedirect, uploadSignal } from "@conveyor/shared/node";
import { historyEnd } from "./history.ts";
import { poll, positiveSetting, reach, unresolved } from "./poll.ts";
import { pruneGcodes } from "./prune.ts";
import { parseQuery, printProgressOf } from "./query.ts";
import { moonrakerReadiness } from "./ready.ts";
import { printWatch, STANDBY_ENDED, STANDBY_POLLS } from "./watch.ts";

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

    const { base, headers } = await reach(target.address, baseUrl, apiKeyHeaders(target));
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
    const query = "/printer/objects/query?print_stats&virtual_sdcard&display_status";
    const headers = statusKeyHeaders(target);
    const timeoutMs = positiveSetting("MOONRAKER_STATUS_TIMEOUT_MS", STATUS_TIMEOUT_MS);
    const failuresAllowed = positiveSetting("MOONRAKER_STATUS_FAILURES", STATUS_FAILURES);
    const pollMs = positiveSetting("MOONRAKER_POLL_MS", POLL_MS);

    yield { state: "transferring" };
    const watch = printWatch();
    let failures = 0;
    let runningChecks = 0;
    while (true) {
      const at = await unresolved(handle.address, baseUrl, headers);
      const res =
        typeof at === "string"
          ? at
          : await poll(`${at.base}${query}`, at.headers, timeoutMs, signal);
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
      const state = ps?.state ?? "unknown";
      const progress = clamp01(
        objects.display_status?.progress ?? objects.virtual_sdcard?.progress ?? 0,
      );
      const step = watch({
        state,
        progress,
        message: ps?.message,
        print: printProgressOf(objects),
      });
      if (step.status?.message === STANDBY_ENDED && typeof at !== "string") {
        const ended = await historyEnd(at.base, at.headers, handle.ref, timeoutMs, signal);
        if (ended.kind === "running" && ++runningChecks < STANDBY_POLLS) {
          await sleep(pollMs, signal);
          continue;
        }
        const why = ended.kind === "unknown" ? ended.why : "the job is still in progress";
        yield ended.kind === "ended"
          ? ended.status
          : { state: "failed", message: `${STANDBY_ENDED} (job history: ${why})` };
        return;
      }
      if (step.status) yield step.status;
      if (step.final) return;
      await sleep(pollMs, signal);
    }
  },

  async cancel(handle: PrintHandle, target?: PrinterTarget, signal?: AbortSignal): Promise<void> {
    if (STUB) return;
    if (!handle.address)
      throw new StageError("transport", "moonraker cancel: missing printer address on handle");
    const at = await reach(handle.address, baseUrl, statusKeyHeaders(target));
    const timeout = AbortSignal.timeout(CANCEL_TIMEOUT_MS);
    if (signal?.aborted)
      throw new StageError("transport", "moonraker cancel abandoned before it was sent");
    const res = await fetch(`${at.base}/printer/print/cancel`, {
      method: "POST",
      headers: at.headers,
      redirect: "manual",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    refuseRedirect(res, "moonraker cancel");
    if (!res.ok) throw new StageError("transport", `moonraker cancel failed: ${res.status}`);
  },

  async pruneFiles(target, keep, signal) {
    if (STUB) return [];
    const at = await reach(target.address, baseUrl, apiKeyHeaders(target));
    const timeoutMs = positiveSetting("MOONRAKER_STATUS_TIMEOUT_MS", STATUS_TIMEOUT_MS);
    return pruneGcodes(at.base, at.headers, keep, timeoutMs, signal);
  },
};

function baseUrl(address: string): string {
  if (/^https?:\/\//i.test(address)) return address.replace(/\/$/, "");
  const { host, path } = addressParts(address);
  const parsed = parseHostPort(host, 80, address);
  if (parsed.kind === "invalid")
    throw new StageError("transport", `moonraker printer address ${parsed.reason}`);
  return `http://${formatHostPort(parsed.host, parsed.port)}${path.replace(/\/$/, "")}`;
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
