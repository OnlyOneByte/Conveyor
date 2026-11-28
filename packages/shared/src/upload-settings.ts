import { join } from "node:path";
import { z } from "zod";

export const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_UPLOADS_FOLDER_BYTES = 2 ** 50;

const folderCap = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(MAX_UPLOADS_FOLDER_BYTES));
export const DEFAULT_UPLOAD_IDLE_TIMEOUT_MS = 30_000;
export const UPLOAD_SLOWEST_BYTES_PER_SECOND = 64 * 1024;
const UPLOAD_TIMEOUT_GRACE_MS = 60_000;

export interface UploadSettings {
  dir: string;
  maxBytes: number;
  idleMs: number;
  deadlineMs: number;
  folderMaxBytes?: number;
}

export function uploadsFolderMaxBytes(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = folderCap.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `CONVEYOR_UPLOADS_MAX_BYTES must be a whole number of bytes from 1 to ${MAX_UPLOADS_FOLDER_BYTES} (1 PiB), digits only, got "${raw}"`,
    );
  }
  return parsed.data;
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
    folderMaxBytes: uploadsFolderMaxBytes(env.CONVEYOR_UPLOADS_MAX_BYTES),
  };
}
