import { join } from "node:path";

export const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const DEFAULT_UPLOAD_IDLE_TIMEOUT_MS = 30_000;
export const UPLOAD_SLOWEST_BYTES_PER_SECOND = 64 * 1024;
const UPLOAD_TIMEOUT_GRACE_MS = 60_000;

export interface UploadSettings {
  dir: string;
  maxBytes: number;
  idleMs: number;
  deadlineMs: number;
}

function positive(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a positive integer, got ${raw}`);
  }
  return value;
}

export const defaultUploadDeadlineMs = (maxBytes: number): number =>
  UPLOAD_TIMEOUT_GRACE_MS + Math.ceil(maxBytes / UPLOAD_SLOWEST_BYTES_PER_SECOND) * 1000;

export function uploadSettings(env: Record<string, string | undefined>): UploadSettings {
  const maxBytes = positive("MAX_UPLOAD_BYTES", env.MAX_UPLOAD_BYTES, DEFAULT_MAX_UPLOAD_BYTES);
  return {
    dir: env.UPLOAD_DIR || join(env.DATA_DIR || "/data", "uploads"),
    maxBytes,
    idleMs: positive(
      "UPLOAD_IDLE_TIMEOUT_MS",
      env.UPLOAD_IDLE_TIMEOUT_MS,
      DEFAULT_UPLOAD_IDLE_TIMEOUT_MS,
    ),
    deadlineMs: positive(
      "UPLOAD_TIMEOUT_MS",
      env.UPLOAD_TIMEOUT_MS,
      defaultUploadDeadlineMs(maxBytes),
    ),
  };
}
