import { describe, expect, test } from "bun:test";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { stlGeometry } from "./stl-geometry.js";

const FACES = [
  [0, 0, 0, 10, 0, 0, 0, 10, 0],
  [0, 0, 0, 0, 10, 0, 0, 0, 7],
  [10, 0, 0, 0, 10, 0, 0, 0, 7],
  [4, 4, 4, 4, 4, 4, 4, 4, 4],
];

const ascii = () =>
  new TextEncoder().encode(
    `solid s\n${FACES.map(
      (f) =>
        `facet normal 0 0 0\nouter loop\nvertex ${f.slice(0, 3).join(" ")}\nvertex ${f.slice(3, 6).join(" ")}\nvertex ${f.slice(6).join(" ")}\nendloop\nendfacet\n`,
    ).join("")}endsolid s\n`,
  ).buffer;

function binary(): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(84 + FACES.length * 50));
  view.setUint32(80, FACES.length, true);
  for (const [i, face] of FACES.entries())
    for (const [j, value] of face.entries()) view.setFloat32(84 + i * 50 + 12 + j * 4, value, true);
  return view.buffer;
}

function viaThree(buffer: ArrayBuffer) {
  const geometry = new STLLoader().parse(buffer);
  geometry.center();
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return {
    position: Array.from(geometry.getAttribute("position").array),
    normal: Array.from(geometry.getAttribute("normal").array),
    radius: geometry.boundingSphere?.radius ?? 0,
  };
}

const close = (a: number[], b: number[]) => {
  expect(a.length).toBe(b.length);
  for (const [i, value] of a.entries()) expect(value).toBeCloseTo(b[i] ?? Number.NaN, 5);
};

describe("stlGeometry matches three's STLLoader, centred with vertex normals", () => {
  for (const [name, make] of [
    ["ASCII", ascii],
    ["binary", binary],
  ] as const) {
    test(name, () => {
      const ours = stlGeometry(make());
      if (!ours) throw new Error("no geometry");
      const theirs = viaThree(make());
      close(Array.from(ours.position), theirs.position);
      close(Array.from(ours.normal), theirs.normal);
      expect(ours.radius).toBeCloseTo(theirs.radius, 5);
    });
  }
});

test("bytes that aren't an STL give no geometry", () => {
  expect(stlGeometry(new Uint8Array([1, 2, 3]).buffer)).toBeNull();
  expect(stlGeometry(new TextEncoder().encode("solid empty\nendsolid empty\n").buffer)).toBeNull();
});
