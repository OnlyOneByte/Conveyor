import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkUpload } from "./upload.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-upload-"));
  dirs.push(dir);
  return dir;
}

function binaryStl(triangles: number, extraBytes = 0): Buffer {
  const body = Buffer.alloc(84 + triangles * 50 + extraBytes);
  body.writeUInt32LE(triangles, 80);
  return body;
}

const ASCII_STL = "solid cube\nendsolid cube\n";

function rulesWith(files: Record<string, string | Buffer>, maxBytes = 1024) {
  const dir = freshDir();
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return { dir, maxBytes };
}

describe("checkUpload", () => {
  test("accepts an ascii STL and a binary STL in the uploads dir", () => {
    const rules = rulesWith({ "a.stl": ASCII_STL, "b.stl": binaryStl(2) });
    expect(checkUpload("a", rules)).toBeNull();
    expect(checkUpload("b", rules)).toBeNull();
  });

  test("rejects an upload that does not exist", () => {
    expect(checkUpload("missing", rulesWith({}))).toEqual({
      field: "uploadId",
      message: "upload missing not found",
    });
  });

  test("rejects a symlink that points outside the uploads dir", () => {
    const outside = join(freshDir(), "secret.stl");
    writeFileSync(outside, ASCII_STL);
    const rules = rulesWith({});
    symlinkSync(outside, join(rules.dir, "escape.stl"));
    expect(checkUpload("escape", rules)?.message).toBe(
      "upload escape is not a regular file in the uploads dir",
    );
  });

  test("rejects a directory named like an upload", () => {
    const rules = rulesWith({});
    mkdirSync(join(rules.dir, "folder.stl"));
    expect(checkUpload("folder", rules)?.message).toContain("is not a regular file");
  });

  test("rejects an upload over the size limit and accepts one at it", () => {
    const rules = rulesWith({ "big.stl": binaryStl(3) }, 84 + 3 * 50 - 1);
    expect(checkUpload("big", rules)?.message).toBe(`upload big exceeds ${84 + 3 * 50 - 1} bytes`);
    expect(checkUpload("big", { ...rules, maxBytes: 84 + 3 * 50 })).toBeNull();
  });

  test.each([
    ["random bytes", Buffer.from("not a model at all")],
    ["a binary header with the wrong triangle count", binaryStl(2, 1)],
    ["an empty file", Buffer.alloc(0)],
  ])("rejects %s as not an STL", (_label, content) => {
    expect(checkUpload("x", rulesWith({ "x.stl": content }))?.message).toBe(
      "upload x is not an STL file",
    );
  });

  test("reports any other filesystem error as unreadable and logs it only on the server", () => {
    const rules = rulesWith({ "plain-file": "x" });
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const issue = checkUpload("x", { ...rules, dir: join(rules.dir, "plain-file") });
      expect(issue).toEqual({ field: "uploadId", message: "upload x could not be read" });
      expect(String(logged.mock.calls[0]?.[1])).toContain("ENOTDIR");
    } finally {
      logged.mockRestore();
    }
  });
});
