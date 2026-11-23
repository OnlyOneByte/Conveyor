import { describe, expect, test } from "bun:test";
import { DEFAULT_MAX_UPLOAD_BYTES, uploadSettings } from "./upload-settings.ts";

describe("uploadSettings", () => {
  test("defaults to /data/uploads and 100 MiB", () => {
    expect(uploadSettings({})).toEqual({ dir: "/data/uploads", maxBytes: 100 * 1024 * 1024 });
    expect(uploadSettings({ MAX_UPLOAD_BYTES: "" }).maxBytes).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });

  test("follows DATA_DIR, UPLOAD_DIR and MAX_UPLOAD_BYTES", () => {
    expect(uploadSettings({ DATA_DIR: "/srv" }).dir).toBe("/srv/uploads");
    expect(uploadSettings({ UPLOAD_DIR: "/up", MAX_UPLOAD_BYTES: "10" })).toEqual({
      dir: "/up",
      maxBytes: 10,
    });
  });

  test("treats an empty UPLOAD_DIR or DATA_DIR as unset instead of the working directory", () => {
    expect(uploadSettings({ UPLOAD_DIR: "", DATA_DIR: "" }).dir).toBe("/data/uploads");
  });

  test.each(["abc", "0", "-5", "1.5", "1e6", " 10", "010", "9007199254740993"])(
    "refuses MAX_UPLOAD_BYTES=%p",
    (raw) => {
      expect(() => uploadSettings({ MAX_UPLOAD_BYTES: raw })).toThrow(
        `MAX_UPLOAD_BYTES must be a positive integer, got ${raw}`,
      );
    },
  );
});
