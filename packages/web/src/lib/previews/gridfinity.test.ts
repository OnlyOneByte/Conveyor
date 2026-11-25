import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { binHeight, boundingRadius, buildGeometry } from "./gridfinity";

const size = (group: THREE.Group) => new THREE.Box3().setFromObject(group);

const meshes = (group: THREE.Group) => group.children.filter((c) => c instanceof THREE.Mesh);

const boxes = (group: THREE.Group) =>
  meshes(group).filter((m) => m instanceof THREE.Mesh && m.geometry instanceof THREE.BoxGeometry);

const cylinders = (group: THREE.Group) =>
  meshes(group).filter(
    (m) => m instanceof THREE.Mesh && m.geometry instanceof THREE.CylinderGeometry,
  );

describe("binHeight", () => {
  test("is 7 mm per height unit, with the default of 6 and a floor of 2", () => {
    expect(binHeight()).toBe(42);
    expect(binHeight({ heightUnits: 3 })).toBe(21);
    expect(binHeight({ heightUnits: 1 })).toBe(14);
  });
});

describe("buildGeometry", () => {
  test("a 2 by 3 bin is 41.5 mm per cell less the gap, as tall as its units, centred on its height", () => {
    const b = size(buildGeometry());
    expect(b.max.x - b.min.x).toBeCloseTo(2 * 42 - 0.5, 1);
    expect(b.max.z - b.min.z).toBeCloseTo(3 * 42 - 0.5, 1);
    expect(b.min.y).toBeCloseTo(-21);
    expect(b.max.y).toBeCloseTo(21);
  });

  test("grows with the grid", () => {
    const b = size(buildGeometry({ gridX: 1, gridY: 1, heightUnits: 3 }));
    expect(b.max.x - b.min.x).toBeCloseTo(41.5, 1);
    expect(b.max.z - b.min.z).toBeCloseTo(41.5, 1);
    expect(b.max.y - b.min.y).toBeCloseTo(21);
  });

  test("magnet holes add a bore wall and floor at each of four corners of every cell", () => {
    const plain = meshes(buildGeometry({ gridX: 2, gridY: 1 }));
    const magnets = buildGeometry({ gridX: 2, gridY: 1, magnetHoles: true });
    expect(meshes(magnets).length - plain.length).toBe(2 * 4 * 2);
    expect(cylinders(magnets)).toHaveLength(8);
  });

  test("dividers add one wall between each pair of compartments", () => {
    const divided = buildGeometry({ divisionsX: 3, divisionsY: 2 });
    expect(boxes(divided)).toHaveLength(2 + 1);
    expect(boxes(buildGeometry())).toHaveLength(0);
  });

  test("a label tab and a scoop each add one part", () => {
    const base = meshes(buildGeometry()).length;
    expect(meshes(buildGeometry({ labelTab: true })).length).toBe(base + 1);
    expect(meshes(buildGeometry({ scoop: true })).length).toBe(base + 1);
    expect(cylinders(buildGeometry({ scoop: true }))).toHaveLength(1);
  });

  test("without a stacking lip the wall is capped flat and stops at the bin's height", () => {
    const lipped = buildGeometry();
    const flat = buildGeometry({ stackingLip: false });
    expect(meshes(lipped).length - meshes(flat).length).toBe(4 - 1);
    expect(size(flat).max.y).toBeCloseTo(21);
  });
});

describe("boundingRadius", () => {
  test("is half the diagonal of the grid footprint and height", () => {
    expect(boundingRadius()).toBeCloseTo(Math.sqrt(84 ** 2 + 126 ** 2 + 42 ** 2) / 2);
    expect(boundingRadius({ gridX: 1, gridY: 1, heightUnits: 2 })).toBeCloseTo(
      Math.sqrt(42 ** 2 + 42 ** 2 + 14 ** 2) / 2,
    );
  });

  test("encloses the built bin", () => {
    const params = { gridX: 3, gridY: 2, heightUnits: 4 };
    const sphere = new THREE.Box3().setFromObject(buildGeometry(params)).getBoundingSphere(
      new THREE.Sphere(),
    );
    expect(sphere.radius).toBeLessThanOrEqual(boundingRadius(params));
  });
});
