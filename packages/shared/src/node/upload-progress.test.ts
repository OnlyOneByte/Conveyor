import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { multipartFileUpload, UPLOAD_REPORT_MS } from "./upload.ts";

const dir = mkdtempSync(join(tmpdir(), "conveyor-upload-progress-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const restores: (() => void)[] = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

function clockStepping(stepMs: number) {
  let now = 1_000_000;
  const spy = spyOn(Date, "now").mockImplementation(() => {
    now += stepMs;
    return now;
  });
  restores.push(() => spy.mockRestore());
}

async function sendAll(size: number) {
  const path = join(dir, `file-${size}.gcode`);
  writeFileSync(path, randomBytes(size));
  const reports: number[][] = [];
  const upload = multipartFileUpload({ field: "file", path, filename: "f.gcode" }, (sent, total) =>
    reports.push([sent, total]),
  );
  const reader = upload.body.getReader();
  let chunks = 0;
  while (!(await reader.read()).done) chunks++;
  return { reports, fileChunks: chunks - 2 };
}

describe("upload bytes sent", () => {
  test("counts only the file's bytes against its size, ending at the full size", async () => {
    clockStepping(UPLOAD_REPORT_MS);
    const { reports, fileChunks } = await sendAll(4 * 1024 * 1024);
    expect(fileChunks).toBeGreaterThan(1);
    expect(reports).toHaveLength(fileChunks);
    expect(reports.at(-1)).toEqual([4 * 1024 * 1024, 4 * 1024 * 1024]);
    expect(reports.every(([, total]) => total === 4 * 1024 * 1024)).toBe(true);
    const sent = reports.map(([bytes]) => bytes ?? 0);
    expect(sent).toEqual([...sent].sort((a, b) => a - b));
    expect(new Set(sent).size).toBe(sent.length);
  });

  test("reports at most once per interval, and always the last chunk", async () => {
    clockStepping(UPLOAD_REPORT_MS - 1);
    const { reports, fileChunks } = await sendAll(4 * 1024 * 1024);
    expect(fileChunks).toBeGreaterThan(3);
    expect(reports.length).toBeLessThan(fileChunks);
    expect(reports.length).toBe(Math.ceil((fileChunks - 1) / 2) + 1);
    expect(reports.at(-1)).toEqual([4 * 1024 * 1024, 4 * 1024 * 1024]);
  });
});
