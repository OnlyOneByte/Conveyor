import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { basename, join } from "node:path";
import type { ParamIssue } from "@conveyor/shared";
import type { UploadSettings } from "@conveyor/shared/uploads";

const BINARY_STL_HEADER_BYTES = 84;
const BINARY_STL_TRIANGLE_BYTES = 50;
const ASCII_STL_PREFIX = "solid";
const OPEN_WITHOUT_FOLLOWING = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

function readHeader(fd: number): Buffer {
  const header = Buffer.alloc(BINARY_STL_HEADER_BYTES);
  return header.subarray(0, readSync(fd, header, 0, header.length, 0));
}

function looksLikeStl(fd: number, size: number): boolean {
  const header = readHeader(fd);
  if (header.toString("latin1", 0, ASCII_STL_PREFIX.length) === ASCII_STL_PREFIX) return true;
  if (header.length < BINARY_STL_HEADER_BYTES) return false;
  const triangles = header.readUInt32LE(BINARY_STL_HEADER_BYTES - 4);
  return size === BINARY_STL_HEADER_BYTES + triangles * BINARY_STL_TRIANGLE_BYTES;
}

function inspectOpenUpload(fd: number, uploadId: string, maxBytes: number): string | null {
  const stats = fstatSync(fd);
  if (!stats.isFile()) return `upload ${uploadId} is not a regular file in the uploads dir`;
  if (stats.size > maxBytes) return `upload ${uploadId} exceeds ${maxBytes} bytes`;
  if (!looksLikeStl(fd, stats.size)) return `upload ${uploadId} is not an STL file`;
  return null;
}

function codeOf(err: unknown): unknown {
  return err instanceof Error && "code" in err ? err.code : undefined;
}

function describeFailure(err: unknown, uploadId: string): string {
  if (codeOf(err) === "ENOENT") return `upload ${uploadId} not found`;
  if (codeOf(err) === "ELOOP") return `upload ${uploadId} is not a regular file in the uploads dir`;
  console.error(`[uploads] could not read upload ${uploadId}:`, err);
  return `upload ${uploadId} could not be read`;
}

function inspectUpload(path: string, uploadId: string, maxBytes: number): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, OPEN_WITHOUT_FOLLOWING);
    return inspectOpenUpload(fd, uploadId, maxBytes);
  } catch (err) {
    return describeFailure(err, uploadId);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function checkUpload(
  uploadId: string,
  settings: Pick<UploadSettings, "dir" | "maxBytes">,
): ParamIssue | null {
  const path = join(settings.dir, `${basename(uploadId)}.stl`);
  const message = inspectUpload(path, uploadId, settings.maxBytes);
  return message ? { field: "uploadId", message } : null;
}
