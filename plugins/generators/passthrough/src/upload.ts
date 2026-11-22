import { closeSync, lstatSync, openSync, readSync, type Stats } from "node:fs";
import { basename, join } from "node:path";
import type { ParamIssue } from "@conveyor/shared";

const BINARY_STL_HEADER_BYTES = 84;
const BINARY_STL_TRIANGLE_BYTES = 50;
const ASCII_STL_PREFIX = "solid";

export interface UploadRules {
  dir: string;
  maxBytes: number;
}

export function uploadRules(env: Record<string, string | undefined>): UploadRules {
  const dataDir = env.DATA_DIR ?? "/data";
  return {
    dir: env.UPLOAD_DIR ?? join(dataDir, "uploads"),
    maxBytes: Number(env.MAX_UPLOAD_BYTES ?? 100 * 1024 * 1024),
  };
}

function readHeader(path: string): Buffer {
  const header = Buffer.alloc(BINARY_STL_HEADER_BYTES);
  const fd = openSync(path, "r");
  try {
    return header.subarray(0, readSync(fd, header, 0, header.length, 0));
  } finally {
    closeSync(fd);
  }
}

function looksLikeStl(path: string, size: number): boolean {
  const header = readHeader(path);
  if (header.toString("latin1", 0, ASCII_STL_PREFIX.length) === ASCII_STL_PREFIX) return true;
  if (header.length < BINARY_STL_HEADER_BYTES) return false;
  const triangles = header.readUInt32LE(BINARY_STL_HEADER_BYTES - 4);
  return size === BINARY_STL_HEADER_BYTES + triangles * BINARY_STL_TRIANGLE_BYTES;
}

function statOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return null;
    throw err;
  }
}

export function checkUpload(uploadId: string, rules: UploadRules): ParamIssue | null {
  const path = join(rules.dir, `${basename(uploadId)}.stl`);
  const stats = statOrNull(path);
  const issue = (message: string): ParamIssue => ({ field: "uploadId", message });
  if (!stats) return issue(`upload ${uploadId} not found`);
  if (!stats.isFile()) return issue(`upload ${uploadId} is not a regular file in the uploads dir`);
  if (stats.size > rules.maxBytes)
    return issue(`upload ${uploadId} exceeds ${rules.maxBytes} bytes`);
  if (!looksLikeStl(path, stats.size)) return issue(`upload ${uploadId} is not an STL file`);
  return null;
}
