import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
  annulus,
  band,
  face,
  QUADS_PER_CORNER,
  ring,
  roundProfile,
  type Section,
  sweepSolid,
  undersideFace,
} from "./gridfinity-mesh";

const box = (geo: THREE.BufferGeometry) => {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  if (!b) throw new Error("no bounding box");
  return b;
};

const meanNormalY = (geo: THREE.BufferGeometry) => {
  const normals = geo.getAttribute("normal");
  let sum = 0;
  for (let i = 0; i < normals.count; i++) sum += normals.getY(i);
  return sum / normals.count;
};

const triangles = (geo: THREE.BufferGeometry) => (geo.getIndex()?.count ?? 0) / 3;

describe("ring", () => {
  test("traces four rounded corners that span the full width and depth", () => {
    const pts = ring(40, 20, 4);
    expect(pts).toHaveLength(4 * (QUADS_PER_CORNER + 1));
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.y);
    expect(Math.max(...xs)).toBeCloseTo(20);
    expect(Math.min(...xs)).toBeCloseTo(-20);
    expect(Math.max(...zs)).toBeCloseTo(10);
    expect(Math.min(...zs)).toBeCloseTo(-10);
  });

  test("clamps a corner radius too large for the outline and too small to draw", () => {
    const big = ring(10, 10, 50);
    const tiny = ring(10, 10, 0);
    const radius = (pts: THREE.Vector2[]) => Math.max(...pts.map((p) => p.x)) - pts[0].x;
    expect(Math.max(...big.map((p) => p.x))).toBeCloseTo(5);
    expect(radius(big)).toBeCloseTo(0);
    expect(Math.max(...tiny.map((p) => p.x))).toBeCloseTo(5);
    expect(tiny[0].x).toBeCloseTo(5);
  });
});

describe("faces between rings", () => {
  const outer = ring(20, 20, 3);
  const inner = ring(16, 16, 1);

  test("a band joins two rings with two triangles per edge and faces outward or inward", () => {
    const out = band(outer, 0, outer, 5, false);
    const inward = band(outer, 0, outer, 5, true);
    expect(triangles(out)).toBe(2 * outer.length);
    const b = box(out);
    expect(b.min.y).toBe(0);
    expect(b.max.y).toBe(5);
    const firstX = (geo: THREE.BufferGeometry) => geo.getAttribute("normal").getX(0);
    expect(firstX(out)).toBeGreaterThan(0);
    expect(firstX(inward)).toBeLessThan(0);
  });

  test("an annulus and a face point up or down as asked", () => {
    expect(meanNormalY(annulus(outer, inner, 2, true))).toBeCloseTo(1);
    expect(meanNormalY(annulus(outer, inner, 2, false))).toBeCloseTo(-1);
    expect(meanNormalY(face(outer, 2, true))).toBeCloseTo(1);
    expect(meanNormalY(face(outer, 2, false))).toBeCloseTo(-1);
    expect(triangles(face(outer, 2, true))).toBe(outer.length);
  });

  test("the underside sits at its height and keeps a hole for each bore", () => {
    const plain = undersideFace(outer, 1.5, []);
    const bored = undersideFace(outer, 1.5, [{ x: 0, z: 0, radius: 3 }]);
    expect(box(plain).min.y).toBeCloseTo(1.5);
    expect(box(plain).max.y).toBeCloseTo(1.5);
    expect(triangles(bored)).toBeGreaterThan(triangles(plain));
    const nearCentre = (geo: THREE.BufferGeometry) => {
      const pos = geo.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        if (Math.hypot(pos.getX(i), pos.getZ(i)) < 2.9) return true;
      }
      return false;
    };
    expect(nearCentre(bored)).toBe(false);
  });
});

describe("roundProfile", () => {
  const corner: Section[] = [
    { inset: 0, y: 0 },
    { inset: 0, y: 10 },
    { inset: 10, y: 10 },
  ];

  test("leaves a profile of fewer than three sections alone", () => {
    const two = corner.slice(0, 2);
    expect(roundProfile(two, 1, 3)).toBe(two);
  });

  test("replaces a corner with an arc and keeps both ends", () => {
    const out = roundProfile(corner, 1, 4);
    expect(out).toHaveLength(2 + 5);
    expect(out[0]).toEqual(corner[0]);
    expect(out.at(-1)).toEqual(corner[2]);
    expect(out).not.toContainEqual(corner[1]);
    expect(out[1].inset).toBeCloseTo(0);
    expect(out[1].y).toBeCloseTo(9);
    expect(out[5].inset).toBeCloseTo(1);
    expect(out[5].y).toBeCloseTo(10);
  });

  test("keeps a straight-through section as it is", () => {
    const straight: Section[] = [
      { inset: 0, y: 0 },
      { inset: 0, y: 5 },
      { inset: 0, y: 10 },
    ];
    expect(roundProfile(straight, 1, 4)).toEqual(straight);
  });
});

describe("sweepSolid", () => {
  const profile: Section[] = [
    { inset: 1, y: 0 },
    { inset: 0, y: 2 },
    { inset: 0, y: 4 },
  ];

  test("stacks one ring per section, from the base height up", () => {
    const geo = sweepSolid(profile, 20, 20, 3, 10, false, false, false);
    const n = 4 * (QUADS_PER_CORNER + 1);
    expect(geo.getAttribute("position").count).toBe(3 * n);
    expect(triangles(geo)).toBe(2 * 2 * n);
    const b = box(geo);
    expect(b.min.y).toBe(10);
    expect(b.max.y).toBe(14);
    expect(b.max.x).toBeCloseTo(10);
  });

  test("adds a centre vertex and a fan for each cap asked for", () => {
    const n = 4 * (QUADS_PER_CORNER + 1);
    const both = sweepSolid(profile, 20, 20, 3, 0, false, true, true);
    const first = sweepSolid(profile, 20, 20, 3, 0, false, true, false);
    expect(both.getAttribute("position").count).toBe(3 * n + 2);
    expect(triangles(both)).toBe(4 * n + 2 * n);
    expect(triangles(first)).toBe(4 * n + n);
  });
});
