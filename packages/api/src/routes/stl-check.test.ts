import { expect, test } from "bun:test";
import { looksLikeStl, readFailure } from "./stl-check.js";

test("an ASCII STL needs solid and a facet; leading whitespace is fine", () => {
  expect(looksLikeStl(Buffer.from("  solid a\n facet normal 0 0 1\n"))).toBe(true);
  expect(looksLikeStl(Buffer.from("solid a\nendsolid a\n"))).toBe(false);
  expect(looksLikeStl(Buffer.from("facet solid"))).toBe(false);
});

test("a binary STL's length must match the triangle count in its header", () => {
  const stl = Buffer.alloc(84 + 50 * 2);
  stl.writeUInt32LE(2, 80);
  expect(looksLikeStl(stl)).toBe(true);
  expect(looksLikeStl(stl.subarray(0, 84 + 50))).toBe(false);
  expect(looksLikeStl(Buffer.alloc(40))).toBe(false);
});

test("only the size limit is a 413; a broken body is a 400; anything else is the server's", () => {
  expect(
    readFailure(Object.assign(new Error("too large"), { code: "FST_REQ_FILE_TOO_LARGE" })),
  ).toBe(413);
  expect(readFailure(new Error("Unexpected end of multipart data"))).toBe(400);
  expect(readFailure(new RangeError("Array buffer allocation failed"))).toBeNull();
  expect(readFailure("not an error")).toBeNull();
});

test("a binary STL is exactly 84 + 50 × triangles bytes, no more and no fewer", () => {
  const stl = Buffer.alloc(84 + 50 * 2 + 1);
  stl.writeUInt32LE(2, 80);
  expect(looksLikeStl(stl)).toBe(false);
  expect(looksLikeStl(stl.subarray(0, 84 + 50 * 2 - 1))).toBe(false);
  expect(looksLikeStl(stl.subarray(0, 84 + 50 * 2))).toBe(true);
});

test("a binary STL with no triangles is refused, since there is nothing to slice", () => {
  expect(looksLikeStl(Buffer.alloc(84))).toBe(false);
});

test("an ASCII STL saved with a UTF-8 byte-order mark is accepted", () => {
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  expect(looksLikeStl(Buffer.concat([bom, Buffer.from("solid a\nfacet normal 0 0 1\n")]))).toBe(
    true,
  );
  expect(looksLikeStl(Buffer.concat([bom, Buffer.from("not a model")]))).toBe(false);
});

test("only the exact UTF-8 byte-order mark is skipped, not any leading bytes", () => {
  const ascii = Buffer.from("solid a\nfacet normal 0 0 1\n");
  for (const lead of [
    [0xef, 0xbb, 0xbe],
    [0xef, 0xbb],
    [0xff, 0xfe],
    [0x00],
    [0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf],
  ])
    expect(looksLikeStl(Buffer.concat([Buffer.from(lead), ascii]))).toBe(false);
});
