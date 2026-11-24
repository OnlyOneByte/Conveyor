import { statSync } from "node:fs";
import { StageError } from "../context.js";

export interface FileUpload {
  body: ReadableStream<Uint8Array>;
  headers: Record<string, string>;
}

export const UPLOAD_TIMEOUT_ENV = "CONVEYOR_UPLOAD_TIMEOUT_MS";

export const DEFAULT_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

export function uploadTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env[UPLOAD_TIMEOUT_ENV];
  if (raw === undefined || raw === "") return DEFAULT_UPLOAD_TIMEOUT_MS;
  const ms = Number(raw);
  if (Number.isInteger(ms) && ms > 0) return ms;
  throw new StageError(
    "transport",
    `${UPLOAD_TIMEOUT_ENV} must be a positive integer of milliseconds, got ${raw}`,
  );
}

export function uploadSignal(
  cancel: AbortSignal,
  env: Record<string, string | undefined> = process.env,
): AbortSignal {
  return AbortSignal.any([cancel, AbortSignal.timeout(uploadTimeoutMs(env))]);
}

export interface UploadPart {
  field: string;
  path: string;
  filename: string;
}

export type SentListener = (bytesSent: number, bytesTotal: number) => void;

export const UPLOAD_REPORT_MS = 250;

function throttled(onSent: SentListener, bytesTotal: number): (bytesSent: number) => void {
  let lastAt = Number.NEGATIVE_INFINITY;
  return (bytesSent) => {
    const now = Date.now();
    if (bytesSent < bytesTotal && now - lastAt < UPLOAD_REPORT_MS) return;
    lastAt = now;
    onSent(bytesSent, bytesTotal);
  };
}

export function multipartFileUpload(
  { field, path, filename }: UploadPart,
  onSent: SentListener = () => {},
): FileUpload {
  const boundary = `----conveyor-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const safeName = filename.replace(/["\\\r\n]/g, "_");
  const head = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${safeName}"\r\n` +
      "Content-Type: application/octet-stream\r\n\r\n",
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const file = Bun.file(path);
  const declared = file.size;
  const report = throttled(onSent, declared);
  const open = () => file.stream().getReader();
  let reader: ReturnType<typeof open> | undefined;
  let sentHead = false;
  let sent = 0;
  const changed = (read: number) =>
    new Error(
      `${filename} changed size while uploading: declared ${declared} bytes, read ${read}, now ${statSync(path).size} on disk`,
    );
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (!sentHead) {
          sentHead = true;
          controller.enqueue(head);
          return;
        }
        reader ??= open();
        const { done, value } = await reader.read();
        if (!done) {
          sent += value.length;
          if (sent > declared) {
            await reader.cancel();
            controller.error(changed(sent));
            return;
          }
          controller.enqueue(value);
          report(sent);
          return;
        }
        if (sent !== declared || statSync(path).size !== declared) {
          controller.error(changed(sent));
          return;
        }
        controller.enqueue(tail);
        controller.close();
      },
      async cancel(reason) {
        await reader?.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
  return {
    body,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(head.length + declared + tail.length),
    },
  };
}
