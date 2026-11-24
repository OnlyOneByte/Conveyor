import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StageError } from "../context.ts";
import {
  DEFAULT_UPLOAD_TIMEOUT_MS,
  multipartFileUpload,
  UPLOAD_TIMEOUT_ENV,
  uploadSignal,
  uploadTimeoutMs,
} from "./upload.ts";

const dir = mkdtempSync(join(tmpdir(), "conveyor-upload-guards-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const drain = (body: ReadableStream<Uint8Array>) => new Response(body).arrayBuffer();

describe("a file that changes size after the upload is built", () => {
  test("a grown file fails the stream instead of sending more than Content-Length", async () => {
    const path = join(dir, "grows.gcode");
    writeFileSync(path, "G28\n");
    const upload = multipartFileUpload({ field: "file", path, filename: "grows.gcode" });
    appendFileSync(path, "G1 X10\n".repeat(1000));
    await expect(drain(upload.body)).rejects.toThrow(
      "grows.gcode changed size while uploading: declared 4 bytes",
    );
  });

  test("a shrunk file fails the stream instead of leaving the printer waiting for bytes", async () => {
    const path = join(dir, "shrinks.gcode");
    writeFileSync(path, "G28\nG1 X10\n");
    const upload = multipartFileUpload({ field: "file", path, filename: "shrinks.gcode" });
    truncateSync(path, 4);
    await expect(drain(upload.body)).rejects.toThrow(
      "shrinks.gcode changed size while uploading: declared 11 bytes, read 4",
    );
  });

  test("an unchanged file still sends exactly Content-Length bytes", async () => {
    const path = join(dir, "same.gcode");
    writeFileSync(path, "G28\nG1 X10\n");
    const upload = multipartFileUpload({ field: "file", path, filename: "same.gcode" });
    const sent = await drain(upload.body);
    expect(sent.byteLength).toBe(Number(upload.headers["content-length"]));
  });
});

describe("the part's filename", () => {
  test("maps a backslash to _ so it can't escape the quoted filename", async () => {
    const path = join(dir, "slash.gcode");
    writeFileSync(path, "G28\n");
    const upload = multipartFileUpload({ field: "file", path, filename: 'bins\\a\\".gcode' });
    const text = await new Response(upload.body).text();
    expect(text).toContain('filename="bins_a__.gcode"');
  });
});

describe("the upload timeout", () => {
  test(`defaults to 10 minutes and reads ${UPLOAD_TIMEOUT_ENV}`, () => {
    expect(uploadTimeoutMs({})).toBe(DEFAULT_UPLOAD_TIMEOUT_MS);
    expect(DEFAULT_UPLOAD_TIMEOUT_MS).toBe(600_000);
    expect(uploadTimeoutMs({ [UPLOAD_TIMEOUT_ENV]: "" })).toBe(DEFAULT_UPLOAD_TIMEOUT_MS);
    expect(uploadTimeoutMs({ [UPLOAD_TIMEOUT_ENV]: "1500" })).toBe(1500);
  });

  test("a value that isn't a positive integer fails the transport stage by name", () => {
    for (const bad of ["0", "-5", "1.5", "soon"]) {
      expect(() => uploadTimeoutMs({ [UPLOAD_TIMEOUT_ENV]: bad })).toThrow(StageError);
      expect(() => uploadTimeoutMs({ [UPLOAD_TIMEOUT_ENV]: bad })).toThrow(
        `${UPLOAD_TIMEOUT_ENV} must be a positive integer of milliseconds, got ${bad}`,
      );
    }
  });

  test("aborts with a TimeoutError once the timeout passes", async () => {
    const signal = uploadSignal(new AbortController().signal, { [UPLOAD_TIMEOUT_ENV]: "20" });
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    expect((signal.reason as Error).name).toBe("TimeoutError");
  });

  test("aborts at once when the job is canceled, with the cancel's reason", () => {
    const cancel = new AbortController();
    const signal = uploadSignal(cancel.signal, {});
    cancel.abort("canceled");
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe("canceled");
  });
});
