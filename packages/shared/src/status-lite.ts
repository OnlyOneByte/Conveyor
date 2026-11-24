import type { JobStatusEvent, PrintProgress } from "./events.js";
import type { StageTiming } from "./job.js";
import { JOB_STATES, type JobState } from "./job-states.js";
import type { Stage } from "./plugins.js";

type Fields = Record<string, unknown>;

const STAGES: readonly Stage[] = ["generator", "slicer", "transport"];

const isRecord = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isCount = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value) && value >= 0;

const isState = (value: unknown): value is JobState => JOB_STATES.some((s) => s === value);

const isStage = (value: unknown): value is Stage => STAGES.some((s) => s === value);

const isString = (value: unknown): value is string => typeof value === "string";

function optional<T>(value: unknown, check: (v: unknown) => v is T): value is T | undefined {
  return value === undefined || check(value);
}

function timing(value: unknown): StageTiming | undefined {
  if (!isRecord(value) || !isStage(value.stage) || !isNumber(value.enteredAt)) return undefined;
  if (!optional(value.durationMs, isNumber)) return undefined;
  const out: StageTiming = { stage: value.stage, enteredAt: value.enteredAt };
  if (value.durationMs !== undefined) out.durationMs = value.durationMs;
  return out;
}

function printOf(value: unknown): PrintProgress | null {
  if (!isRecord(value)) return null;
  const { layer, layers, secondsLeft } = value;
  if (!optional(layer, isCount) || !optional(secondsLeft, isNumber)) return null;
  if (!optional(layers, (v): v is number => isCount(v) && v > 0)) return null;
  if (secondsLeft !== undefined && secondsLeft < 0) return null;
  const out: PrintProgress = {};
  if (layer !== undefined) out.layer = layer;
  if (layers !== undefined) out.layers = layers;
  if (secondsLeft !== undefined) out.secondsLeft = secondsLeft;
  return out;
}

function eventOf(value: unknown): JobStatusEvent | undefined {
  if (!isRecord(value) || !isString(value.jobId) || !isState(value.state) || !isNumber(value.at)) {
    return undefined;
  }
  const event: JobStatusEvent = { jobId: value.jobId, state: value.state, at: value.at };
  const { seq, stage, progress, message, error, timings, print, bytesSent, bytesTotal } = value;
  if (!optional(seq, isNumber) || !optional(progress, isNumber)) return undefined;
  if (!optional(message, isString) || !optional(bytesSent, isCount)) return undefined;
  if (!optional(bytesTotal, isCount)) return undefined;
  if (stage !== undefined && stage !== null && !isStage(stage)) return undefined;
  if (seq !== undefined) event.seq = seq;
  if (stage !== undefined) event.stage = stage;
  if (progress !== undefined) event.progress = progress;
  if (message !== undefined) event.message = message;
  if (bytesSent !== undefined) event.bytesSent = bytesSent;
  if (bytesTotal !== undefined) event.bytesTotal = bytesTotal;
  if (error !== undefined) {
    if (!isRecord(error) || !isStage(error.stage) || !isString(error.reason)) return undefined;
    event.error = { stage: error.stage, reason: error.reason };
  }
  if (timings !== undefined) {
    if (!Array.isArray(timings)) return undefined;
    const parsed = timings.map(timing);
    if (parsed.some((t) => t === undefined)) return undefined;
    event.timings = parsed.filter((t): t is StageTiming => t !== undefined);
  }
  if (print !== undefined) {
    const parsed = printOf(print);
    if (parsed === null) return undefined;
    event.print = parsed;
  }
  return event;
}

export function parseStatusEvent(raw: string | null | undefined): JobStatusEvent | undefined {
  if (!raw) return undefined;
  try {
    return eventOf(JSON.parse(raw));
  } catch {
    return undefined;
  }
}
