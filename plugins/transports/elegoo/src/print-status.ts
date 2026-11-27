import type { PrintProgress, PrintStatus } from "@conveyor/shared";
import { exhaustive, type SdcpPush, type SdcpStatusFrame } from "./sdcp.js";

const SDCP_COMPLETE = 9;
const SDCP_STOPPED = 8;
const SDCP_PRINTING = 13;

const isCount = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 0;

const isTime = (n: number | null): n is number => n !== null && Number.isFinite(n) && n >= 0;

function printProgressOf(frame: SdcpStatusFrame): PrintProgress | undefined {
  const { currentLayer, totalLayer, currentTicks, totalTicks } = frame;
  const print: PrintProgress = {};
  if (isCount(currentLayer)) print.layer = currentLayer;
  if (isCount(totalLayer) && totalLayer > 0) print.layers = totalLayer;
  if (isTime(currentTicks) && isTime(totalTicks) && totalTicks >= currentTicks && totalTicks > 0)
    print.secondsLeft = Math.round(totalTicks - currentTicks);
  return Object.keys(print).length > 0 ? print : undefined;
}

export interface Watched {
  filename?: string;
  priorTask?: string;
  printing?: PrintStatus;
}

const baseName = (path: string) => path.split("/").pop() ?? path;

function isThisPrint(frame: SdcpStatusFrame, { filename, priorTask, printing }: Watched) {
  if (printing !== undefined) return true;
  if (
    filename !== undefined &&
    frame.filename !== undefined &&
    baseName(frame.filename) === filename
  )
    return true;
  return priorTask !== undefined && frame.taskId !== undefined && frame.taskId !== priorTask;
}

function printStatusOf(frame: SdcpStatusFrame, watched: Watched): PrintStatus | undefined {
  const sub = frame.printStatus;
  if (sub === SDCP_COMPLETE || sub === SDCP_STOPPED) {
    if (!isThisPrint(frame, watched)) return undefined;
    return sub === SDCP_COMPLETE
      ? { state: "done", progress: 1 }
      : { state: "canceled", message: "stopped on printer" };
  }
  if (frame.currentStatus.includes(1) || sub === SDCP_PRINTING) {
    return { state: "printing", progress: frame.progress, print: printProgressOf(frame) };
  }
  return undefined;
}

export function toPrintStatus(push: SdcpPush, watched: Watched): PrintStatus | undefined {
  switch (push.kind) {
    case "error":
      if (watched.printing)
        return {
          ...watched.printing,
          message: `printer reported SDCP error ${push.errorCode} while printing`,
        };
      return { state: "failed", message: `printer reported SDCP error ${push.errorCode}` };
    case "status":
      return printStatusOf(push.status, watched);
    default:
      return exhaustive(push);
  }
}
