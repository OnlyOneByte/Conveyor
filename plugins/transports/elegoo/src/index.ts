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
import {
  multipartFileUpload,
  refuseRedirect,
  requirePrinterAddress,
  uploadSignal,
} from "@conveyor/shared/node";
import { z } from "zod";
import { pruneLocalFiles } from "./prune.js";
import { elegooStatusOnce, readinessOf } from "./ready.js";
import { SDCP_CMD } from "./sdcp.js";
import { printerEndpoint, SdcpRejectedError, sendCommand, streamStatus } from "./socket.js";

const STUB = process.env.CONVEYOR_ENGINE_STUB === "1";
const STATUS_IDLE_TIMEOUT_MS = Number(process.env.ELEGOO_STATUS_TIMEOUT_MS ?? 10 * 60 * 1000);

export const START_TIMEOUT_ENV = "ELEGOO_START_TIMEOUT_MS";
export const START_TIMEOUT_MS = 30_000;
const PositiveMs = z.coerce.number().int().positive();

export function startTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env[START_TIMEOUT_ENV];
  if (raw === undefined || raw.trim() === "") return START_TIMEOUT_MS;
  const parsed = PositiveMs.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new StageError(
    "transport",
    `${START_TIMEOUT_ENV} must be a whole number above 0, got ${raw}`,
  );
}

export async function startPrint(
  address: string,
  mainboardId: string,
  filename: string,
  timeoutMs = startTimeoutMs(),
) {
  let sent = false;
  const start = {
    mainboardId,
    cmd: SDCP_CMD.START_PRINT,
    data: { Filename: filename, StartLayer: 0 },
  };
  const onSent = () => {
    sent = true;
  };
  await sendCommand(address, start, true, { onSent, timeoutMs }).catch((err: unknown) => {
    if (err instanceof SdcpRejectedError)
      throw new PrintNotStartedError(err.reason, { cause: err });
    if (!sent) throw err;
    const why = err instanceof Error ? err.message : String(err);
    throw new PrintMayHaveStartedError(`elegoo START_PRINT was sent but not acknowledged: ${why}`);
  });
}

export const elegoo: TransportPlugin = {
  id: "elegoo",
  name: "ElegooLink",
  version: "0.1.0",
  stage: "transport",
  acceptsFlavors: ["klipper", "marlin"],

  async submit(gcode: GcodeArtifact, target: PrinterTarget, ctx: StageCtx): Promise<PrintHandle> {
    const filename = printerFileName(ctx.jobId);
    if (STUB) {
      ctx.log(`[stub] elegoo upload ${gcode.path} → ${target.address}`);
      return elegooHandle(target, filename);
    }

    const ackTimeoutMs = startTimeoutMs();
    const mainboardId = mainboardIdOf(target);
    const at = await pinned(target.address);
    const signal = ctx.signal;
    refuseUnlessIdle(
      "elegoo",
      readinessOf(await elegooStatusOnce(at, mainboardId, undefined, signal)),
    );
    await uploadGcode(at, gcode.path, filename, ctx);

    if (ctx.signal.aborted) throw new PrintNotStartedError("canceled before START_PRINT");
    await ctx.confirmStart?.();
    const startAt = await pinned(target.address);
    const justBefore = await elegooStatusOnce(startAt, mainboardId, undefined, signal);
    refuseUnlessIdle("elegoo", readinessOf(justBefore));
    const priorTask = justBefore.kind === "status" ? (justBefore.status.taskId ?? "") : undefined;
    ctx.log(`elegoo SDCP cmd ${SDCP_CMD.START_PRINT} → ${target.address}`);
    await startPrint(startAt, mainboardId, filename, ackTimeoutMs);

    return elegooHandle(target, filename, priorTask);
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

    const at = await pinned(handle.address);
    yield { state: "transferring" };
    const stream = {
      address: at,
      mainboardId: handle.deviceId ?? handle.printerId,
      idleTimeoutMs: STATUS_IDLE_TIMEOUT_MS,
      filename: handle.ref,
      priorTask: handle.priorTask,
    };
    for await (const s of streamStatus(stream, signal)) {
      yield s;
      if (s.state === "done" || s.state === "failed" || s.state === "canceled") return;
    }
  },

  async cancel(handle: PrintHandle, _target?: PrinterTarget, signal?: AbortSignal): Promise<void> {
    if (STUB) return;
    if (!handle.address)
      throw new StageError("transport", "elegoo cancel: missing printer address on handle");
    const at = await pinned(handle.address);
    const mainboardId = handle.deviceId ?? handle.printerId;
    const stop = { mainboardId, cmd: SDCP_CMD.STOP_PRINT, data: {} };
    await sendCommand(at, stop, true, { signal });
  },

  async pruneFiles(target, keep, signal) {
    if (STUB) return [];
    return pruneLocalFiles(await pinned(target.address), mainboardIdOf(target), keep, signal);
  },
};

async function pinned(address: string): Promise<string> {
  const ip = await requirePrinterAddress(address);
  const at = ip === undefined ? undefined : printerEndpoint(address, ip);
  return at === undefined || at === printerEndpoint(address) ? address : at;
}

function mainboardIdOf(target: PrinterTarget): string {
  return target.secrets?.mainboardId ?? target.id;
}

function elegooHandle(target: PrinterTarget, ref: string, priorTask?: string): PrintHandle {
  return {
    transportId: "elegoo",
    printerId: target.id,
    ref,
    address: target.address,
    deviceId: mainboardIdOf(target),
    ...(priorTask === undefined ? {} : { priorTask }),
  };
}

async function uploadGcode(
  address: string,
  path: string,
  filename: string,
  ctx: StageCtx,
): Promise<void> {
  const upload = multipartFileUpload({ field: "File", path, filename }, (sent, total) =>
    ctx.reportUpload?.(sent, total),
  );
  const url = `http://${printerEndpoint(address)}/uploadFile/upload`;
  const signal = uploadSignal(ctx.signal);
  const init: RequestInit = {
    method: "POST",
    body: upload.body,
    headers: upload.headers,
    redirect: "manual",
    signal,
  };
  const res = await fetch(url, init).catch((e) => {
    const reason = `elegoo upload failed: ${e instanceof Error ? e.message : String(e)}`;
    throw ctx.signal.aborted
      ? new PrintNotStartedError(reason)
      : new StageError("transport", reason);
  });
  refuseRedirect(res, "elegoo upload");
  if (!res.ok)
    throw new StageError(
      "transport",
      `elegoo upload failed: ${res.status} (confirm route — see VERIFY note)`,
    );
}
