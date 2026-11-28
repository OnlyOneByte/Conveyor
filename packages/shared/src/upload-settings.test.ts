import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  DEFAULT_UPLOAD_IDLE_TIMEOUT_MS,
  defaultUploadDeadlineMs,
  MAX_UPLOADS_FOLDER_BYTES,
  uploadSettings,
  uploadsFolderMaxBytes,
} from "./upload-settings.ts";

describe("uploadSettings", () => {
  test("defaults to /data/uploads, 100 MiB, a 30 s idle timeout and a cap scaled to the size", () => {
    expect(uploadSettings({})).toEqual({
      dir: "/data/uploads",
      maxBytes: 100 * 1024 * 1024,
      idleMs: 30_000,
      deadlineMs: 60_000 + 1600 * 1000,
    });
    expect(uploadSettings({ MAX_UPLOAD_BYTES: "" }).maxBytes).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    expect(uploadSettings({ UPLOAD_IDLE_TIMEOUT_MS: "" }).idleMs).toBe(
      DEFAULT_UPLOAD_IDLE_TIMEOUT_MS,
    );
  });

  test("follows DATA_DIR, UPLOAD_DIR and MAX_UPLOAD_BYTES", () => {
    expect(uploadSettings({ DATA_DIR: "/srv" }).dir).toBe("/srv/uploads");
    expect(uploadSettings({ UPLOAD_DIR: "/up", MAX_UPLOAD_BYTES: "10" })).toEqual({
      dir: "/up",
      maxBytes: 10,
      idleMs: 30_000,
      deadlineMs: 61_000,
    });
  });

  test("the default overall cap grows with MAX_UPLOAD_BYTES, at 64 KiB a second plus a minute", () => {
    expect(defaultUploadDeadlineMs(64 * 1024)).toBe(61_000);
    expect(defaultUploadDeadlineMs(64 * 1024 + 1)).toBe(62_000);
    expect(uploadSettings({ MAX_UPLOAD_BYTES: String(640 * 1024) }).deadlineMs).toBe(70_000);
  });

  test("follows UPLOAD_IDLE_TIMEOUT_MS and UPLOAD_TIMEOUT_MS", () => {
    const settings = uploadSettings({ UPLOAD_IDLE_TIMEOUT_MS: "5000", UPLOAD_TIMEOUT_MS: "90000" });
    expect([settings.idleMs, settings.deadlineMs]).toEqual([5000, 90_000]);
  });

  test("treats an empty UPLOAD_DIR or DATA_DIR as unset instead of the working directory", () => {
    expect(uploadSettings({ UPLOAD_DIR: "", DATA_DIR: "" }).dir).toBe("/data/uploads");
  });

  test.each(["MAX_UPLOAD_BYTES", "UPLOAD_IDLE_TIMEOUT_MS", "UPLOAD_TIMEOUT_MS"])(
    "refuses a malformed %s",
    (name) => {
      for (const raw of ["abc", "0", "-5", "1.5", "1e6", " 10", "010", "9007199254740993"]) {
        expect(() => uploadSettings({ [name]: raw })).toThrow(
          `${name} must be a positive integer, got ${raw}`,
        );
      }
    },
  );

  test.each([
    [undefined, undefined],
    ["", undefined],
    ["  ", undefined],
    ["1", 1],
    [" 5000000000 ", 5_000_000_000],
    [String(2 ** 50), 2 ** 50],
  ])("reads CONVEYOR_UPLOADS_MAX_BYTES=%p as %p", (raw, cap) => {
    expect(uploadsFolderMaxBytes(raw)).toBe(cap);
    expect(uploadSettings({ CONVEYOR_UPLOADS_MAX_BYTES: raw }).folderMaxBytes).toBe(cap);
  });

  test.each([
    "0",
    "-1",
    "1.5",
    "1e9",
    "0x100",
    "+5",
    "10GB",
    String(2 ** 50 + 1),
    "99999999999999999999",
  ])("refuses CONVEYOR_UPLOADS_MAX_BYTES=%p, naming the variable and the range", (raw) => {
    expect(() => uploadSettings({ CONVEYOR_UPLOADS_MAX_BYTES: raw })).toThrow(
      `CONVEYOR_UPLOADS_MAX_BYTES must be a whole number of bytes from 1 to ${MAX_UPLOADS_FOLDER_BYTES} (1 PiB), digits only, got "${raw}"`,
    );
  });
});
