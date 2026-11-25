import { describe, expect, test } from "bun:test";
import { fitOnBed, looksInInches, overBy, sizeLine, stlSize } from "./stl-size.js";

type Triangle = [number, number, number][];

function binaryStl(triangles: Triangle[]): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((tri, t) => {
    tri.forEach((point, v) => {
      point.forEach((value, a) => {
        view.setFloat32(84 + t * 50 + 12 + v * 12 + a * 4, value, true);
      });
    });
  });
  return buffer;
}

const asciiStl = (triangles: Triangle[]) =>
  new TextEncoder().encode(
    `solid s\n${triangles
      .map(
        (tri) =>
          `facet normal 0 0 1\nouter loop\n${tri.map((p) => `vertex ${p.join(" ")}`).join("\n")}\nendloop\nendfacet`,
      )
      .join("\n")}\nendsolid s\n`,
  ).buffer;

const box: Triangle[] = [
  [
    [-10, -5, 0],
    [10, -5, 0],
    [10, 5, 0],
  ],
  [
    [-10, 5, 0],
    [10, 5, 30],
    [-10, -5, 30],
  ],
];

describe("stlSize", () => {
  test("measures a binary STL from its vertices, wherever its origin is", () => {
    expect(stlSize(binaryStl(box))).toEqual({ x: 20, y: 10, z: 30 });
  });

  test("measures an ASCII STL the same way", () => {
    expect(stlSize(asciiStl(box))).toEqual({ x: 20, y: 10, z: 30 });
    expect(
      stlSize(
        asciiStl([
          [
            [1e-3, 0, 0],
            [2.5e-3, 1e-3, 0],
            [0, 0, 5e-4],
          ],
        ]),
      ),
    ).toEqual({
      x: 2.5e-3,
      y: 1e-3,
      z: 5e-4,
    });
  });

  test("gives no size for an empty, broken or oversized file rather than a wrong one", () => {
    expect(stlSize(binaryStl([]))).toBeNull();
    expect(stlSize(new TextEncoder().encode("not an stl at all").buffer)).toBeNull();
    expect(
      stlSize(
        binaryStl([
          [
            [0, 0, 0],
            [Number.NaN, 1, 1],
            [1, 1, 1],
          ],
        ]),
      ),
    ).toBeNull();
    const infinite = "solid s\nvertex 0 0 0\nvertex 1 1 inf\nvertex 2 2 2\nendsolid s\n";
    expect(stlSize(new TextEncoder().encode(infinite).buffer)).toBeNull();
    expect(stlSize(binaryStl(box), 100)).toBeNull();
  });

  test("a flat or point-like mesh still has a size, of zero on the flat sides", () => {
    expect(
      stlSize(
        binaryStl([
          [
            [0, 0, 0],
            [5, 0, 0],
            [5, 5, 0],
          ],
        ]),
      ),
    ).toEqual({ x: 5, y: 5, z: 0 });
  });
});

describe("fitOnBed", () => {
  const bed = { x: 220, y: 220, z: 250 };

  test("fits, fits only turned 90°, or says which sides are over", () => {
    expect(fitOnBed({ x: 200, y: 100, z: 50 }, bed)).toEqual({ kind: "fits" });
    expect(fitOnBed({ x: 240, y: 100, z: 50 }, { x: 220, y: 250, z: 250 })).toEqual({
      kind: "turned",
    });
    expect(fitOnBed({ x: 260, y: 100, z: 300 }, bed)).toEqual({
      kind: "over",
      sides: ["wide", "tall"],
    });
    expect(fitOnBed({ x: 230, y: 230, z: 10 }, bed)).toEqual({
      kind: "over",
      sides: ["wide", "deep"],
    });
  });

  test("a tiny model is flagged as likely inches only when it would then fit", () => {
    expect(looksInInches({ x: 2, y: 1, z: 0.5 }, bed)).toBe(true);
    expect(looksInInches({ x: 2.9, y: 2.9, z: 2.9 }, { x: 50, y: 50, z: 50 })).toBe(false);
    expect(looksInInches({ x: 20, y: 10, z: 5 }, bed)).toBe(false);
    expect(looksInInches({ x: 0, y: 0, z: 0 })).toBe(false);
    expect(looksInInches({ x: 1, y: 1, z: 1 })).toBe(true);
  });

  test("says how far over each side is, against the bed", () => {
    const model = { x: 260.4, y: 100, z: 300 };
    expect(overBy(model, bed, ["wide", "tall"])).toBe(
      "260 mm wide (the bed takes 220), 300 mm tall (the bed takes 250)",
    );
  });

  test("sizes read in whole or tenth millimetres", () => {
    expect(sizeLine({ x: 84.04, y: 126, z: 42.16 })).toBe("84 × 126 × 42.2 mm");
    expect(sizeLine({ x: 260.4, y: 0.25, z: 1000 })).toBe("260 × 0.3 × 1000 mm");
  });
});
