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
import { pruneLocalFiles } from "./prune.js";
import { elegooStatusOnce, readinessOf } from "./ready.js";
import { SDCP_CMD } from "./sdcp.js";
import { printerEndpoint, SdcpRejectedError, sendCommand, streamStatus } from "./socket.js";

const STUB = process.env.CONVEYOR_ENGINE_STUB === "1";
const STATUS_IDLE_TIMEOUT_MS = Number(process.env.ELEGOO_STATUS_TIMEOUT_MS ?? 10 * 60 * 1000);

export async function startPrint(address: string, mainboardId: string, filename: string) {
  let sent = false;
  const start = {
    mainboardId,
    cmd: SDCP_CMD.START_PRINT,
    data: { Filename: filename, StartLayer: 0 },
  };
  await sendCommand(address, start, true, () => {
    sent = true;
  }).catch((err: unknown) => {
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

    const mainboardId = mainboardIdOf(target);
    await requirePrinterAddress(target.address);
    const signal = ctx.signal;
    refuseUnlessIdle(
      "elegoo",
      readinessOf(await elegooStatusOnce(target.address, mainboardId, undefined, signal)),
    );
    await uploadGcode(target.address, gcode.path, filename, ctx);

    if (ctx.signal.aborted) throw new PrintNotStartedError("canceled before START_PRINT");
    await ctx.confirmStart?.();
    await requirePrinterAddress(target.address);
    const justBefore = await elegooStatusOnce(target.address, mainboardId, undefined, signal);
    refuseUnlessIdle("elegoo", readinessOf(justBefore));
    const priorTask = justBefore.kind === "status" ? (justBefore.status.taskId ?? "") : undefined;
    ctx.log(`elegoo SDCP cmd ${SDCP_CMD.START_PRINT} → ${target.address}`);
    await startPrint(target.address, mainboardId, filename);

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

    await requirePrinterAddress(handle.address);
    yield { state: "transferring" };
    const stream = {
      address: handle.address,
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

  async cancel(handle: PrintHandle): Promise<void> {
    if (STUB) return;
    if (!handle.address)
      throw new StageError("transport", "elegoo cancel: missing printer address on handle");
    await requirePrinterAddress(handle.address);
    const mainboardId = handle.deviceId ?? handle.printerId;
    await sendCommand(handle.address, { mainboardId, cmd: SDCP_CMD.STOP_PRINT, data: {} }, true);
  },

  async pruneFiles(target, keep, signal) {
    if (STUB) return [];
    await requirePrinterAddress(target.address);
    return pruneLocalFiles(target.address, mainboardIdOf(target), keep, signal);
  },
};

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
