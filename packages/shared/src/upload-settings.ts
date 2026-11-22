import { join } from "node:path";

export const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export interface UploadSettings {
  dir: string;
  maxBytes: number;
}

function parseMaxUploadBytes(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_MAX_UPLOAD_BYTES;
  const bytes = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(bytes)) {
    throw new Error(`MAX_UPLOAD_BYTES must be a positive integer, got ${raw}`);
  }
  return bytes;
}

export function uploadSettings(env: Record<string, string | undefined>): UploadSettings {
  return {
    dir: env.UPLOAD_DIR || join(env.DATA_DIR || "/data", "uploads"),
    maxBytes: parseMaxUploadBytes(env.MAX_UPLOAD_BYTES),
  };
}
