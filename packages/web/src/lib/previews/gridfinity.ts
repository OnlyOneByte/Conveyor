import * as THREE from "three";
import {
  annulus,
  band,
  face,
  ring,
  roundProfile,
  type Section,
  sweepSolid,
  undersideFace,
} from "./gridfinity-mesh";

const GRID_PITCH = 42;
const HEIGHT_UNIT = 7;
const FOOT_WIDTH = 41.5;
const FOOT_GAP = GRID_PITCH - FOOT_WIDTH;
const CORNER_RADIUS = 7.5 / 2;
const WALL_THICKNESS = 1.2;

const BASE_PROFILE_HEIGHT = 4.75;
const BASE_PROFILE: Section[] = [
  { inset: 3.55, y: 0 },
  { inset: 2.95, y: 0 },
  { inset: 2.15, y: 0.8 },
  { inset: 2.15, y: 2.6 },
  { inset: 0, y: BASE_PROFILE_HEIGHT },
  { inset: -0.01, y: BASE_PROFILE_HEIGHT + 0.4 },
];

const LIP_HEIGHT = 4.4;
const LIP_FILLET = 0.6;
const LIP_PROFILE: Section[] = [
  { inset: 2.6, y: 0 },
  { inset: 1.9, y: 0.7 },
  { inset: 1.9, y: 2.5 },
  { inset: LIP_FILLET / 2, y: LIP_HEIGHT },
];

const MAGNET_RADIUS = 6.5 / 2;
const MAGNET_DEPTH = 2.4;
const MAGNET_CENTRE_OFFSET = 13;

const EDGE_ROUNDING = 0.4;
const EDGE_ROUNDING_STEPS = 3;

export interface GridfinityPreviewParams {
  gridX: number;
  gridY: number;
  heightUnits: number;
  divisionsX: number;
  divisionsY: number;
  scoop: boolean;
  labelTab: boolean;
  magnetHoles: boolean;
  stackingLip: boolean;
}

const DEFAULTS: GridfinityPreviewParams = {
  gridX: 2,
  gridY: 3,
  heightUnits: 6,
  divisionsX: 1,
  divisionsY: 1,
  scoop: false,
  labelTab: false,
  magnetHoles: false,
  stackingLip: true,
};

const bodyMat = new THREE.MeshStandardMaterial({
  color: 0x2dd4bf,
  roughness: 0.6,
  metalness: 0.05,
});
const wallMat = new THREE.MeshStandardMaterial({
  color: 0x14b8a6,
  roughness: 0.7,
  metalness: 0.05,
});
const lipMat = new THREE.MeshStandardMaterial({ color: 0x5eead4, roughness: 0.5, metalness: 0.1 });
const tabMat = new THREE.MeshStandardMaterial({ color: 0x99f6e4, roughness: 0.5 });
const boreWallMat = new THREE.MeshStandardMaterial({
  color: 0x0a2523,
  roughness: 1,
  side: THREE.DoubleSide,
});
const boreFloorMat = new THREE.MeshStandardMaterial({ color: 0x04100f, roughness: 1 });

const BASE_SWEEP = roundProfile(BASE_PROFILE, EDGE_ROUNDING, EDGE_ROUNDING_STEPS);
const LIP_SWEEP = roundProfile(LIP_PROFILE, LIP_FILLET / 2, EDGE_ROUNDING_STEPS);

function ringAt(s: Section, w: number, d: number): THREE.Vector2[] {
  return ring(w - 2 * s.inset, d - 2 * s.inset, CORNER_RADIUS - s.inset);
}

export function binHeight(p: Partial<GridfinityPreviewParams> = {}): number {
  return Math.max({ ...DEFAULTS, ...p }.heightUnits, 2) * HEIGHT_UNIT;
}

export function buildGeometry(p: Partial<GridfinityPreviewParams> = {}): THREE.Group {
  const params = { ...DEFAULTS, ...p };
  const g = new THREE.Group();
  const { gridX: gx, gridY: gy } = params;

  const w = gx * GRID_PITCH - FOOT_GAP;
  const d = gy * GRID_PITCH - FOOT_GAP;
  const h = binHeight(params);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => g.add(new THREE.Mesh(geo, mat));

  const footBottom = ringAt(BASE_SWEEP[0], FOOT_WIDTH, FOOT_WIDTH);
  const boreOffsets: [number, number][] = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  const bores = params.magnetHoles
    ? boreOffsets.map(([sx, sz]) => ({
        x: sx * MAGNET_CENTRE_OFFSET,
        z: sz * MAGNET_CENTRE_OFFSET,
        radius: MAGNET_RADIUS,
      }))
    : [];
  for (let cx = 0; cx < gx; cx++) {
    for (let cy = 0; cy < gy; cy++) {
      const ox = (cx - (gx - 1) / 2) * GRID_PITCH;
      const oz = (cy - (gy - 1) / 2) * GRID_PITCH;
      const foot = sweepSolid(
        BASE_SWEEP,
        FOOT_WIDTH,
        FOOT_WIDTH,
        CORNER_RADIUS,
        0,
        false,
        false,
        false,
      );
      foot.translate(ox, 0, oz);
      add(foot, bodyMat);

      const under = undersideFace(footBottom, 0, bores);
      under.translate(ox, 0, oz);
      add(under, bodyMat);

      for (const b of bores) {
        const x = ox + b.x;
        const z = oz + b.z;
        const wall = new THREE.Mesh(
          new THREE.CylinderGeometry(MAGNET_RADIUS, MAGNET_RADIUS, MAGNET_DEPTH, 24, 1, true),
          boreWallMat,
        );
        wall.position.set(x, MAGNET_DEPTH / 2, z);
        g.add(wall);
        const floor = new THREE.Mesh(new THREE.CircleGeometry(MAGNET_RADIUS, 24), boreFloorMat);
        floor.rotation.x = Math.PI / 2;
        floor.position.set(x, MAGNET_DEPTH, z);
        g.add(floor);
      }
    }
  }

  const outer = ring(w, d, CORNER_RADIUS);
  add(band(outer, BASE_PROFILE_HEIGHT, outer, HEIGHT_UNIT, false), bodyMat);
  add(face(outer, BASE_PROFILE_HEIGHT, false), bodyMat);
  add(face(outer, HEIGHT_UNIT, true), bodyMat);

  const wallTop = params.stackingLip ? h - LIP_HEIGHT : h;
  const innerR = ring(
    w - 2 * WALL_THICKNESS,
    d - 2 * WALL_THICKNESS,
    CORNER_RADIUS - WALL_THICKNESS,
  );
  add(band(outer, HEIGHT_UNIT, outer, wallTop, false), wallMat);
  add(band(innerR, HEIGHT_UNIT, innerR, wallTop, true), wallMat);
  if (!params.stackingLip) add(annulus(outer, innerR, wallTop, true), wallMat);

  if (params.stackingLip) {
    const yb = h - LIP_HEIGHT;
    add(sweepSolid(LIP_SWEEP, w, d, CORNER_RADIUS, yb, true, false, false), lipMat);
    add(band(outer, yb, outer, h, false), lipMat);
    add(annulus(outer, ringAt(LIP_SWEEP[0], w, d), yb, false), lipMat);
    add(annulus(outer, ringAt(LIP_SWEEP[LIP_SWEEP.length - 1], w, d), h, true), lipMat);
  }

  const innerW = w - 2 * WALL_THICKNESS;
  const innerD = d - 2 * WALL_THICKNESS;
  const cavityH = wallTop - HEIGHT_UNIT;
  const cavityY = HEIGHT_UNIT + cavityH / 2;
  for (let i = 1; i < params.divisionsX; i++) {
    const x = -innerW / 2 + (innerW / params.divisionsX) * i;
    const m = new THREE.Mesh(new THREE.BoxGeometry(WALL_THICKNESS, cavityH, innerD), wallMat);
    m.position.set(x, cavityY, 0);
    g.add(m);
  }
  for (let j = 1; j < params.divisionsY; j++) {
    const z = -innerD / 2 + (innerD / params.divisionsY) * j;
    const m = new THREE.Mesh(new THREE.BoxGeometry(innerW, cavityH, WALL_THICKNESS), wallMat);
    m.position.set(0, cavityY, z);
    g.add(m);
  }

  if (params.labelTab) {
    const tabW = innerW / params.divisionsX - 1;
    const tab = new THREE.Mesh(new THREE.BoxGeometry(tabW, 1.2, 10), tabMat);
    tab.position.set(-innerW / 2 + tabW / 2 + 0.5, wallTop - 1, -innerD / 2 + 6);
    tab.rotation.x = -0.5;
    g.add(tab);
  }

  if (params.scoop) {
    const r = Math.min(10, innerD / 2);
    const scoopGeo = new THREE.CylinderGeometry(r, r, innerW, 32, 1, false, 0, Math.PI / 2);
    const scoop = new THREE.Mesh(scoopGeo, wallMat);
    scoop.rotation.z = Math.PI / 2;
    scoop.position.set(0, HEIGHT_UNIT + r, d / 2 - WALL_THICKNESS - r);
    g.add(scoop);
  }

  g.position.y = -h / 2;
  return g;
}

export function boundingRadius(p: Partial<GridfinityPreviewParams> = {}): number {
  const params = { ...DEFAULTS, ...p };
  const w = params.gridX * GRID_PITCH;
  const d = params.gridY * GRID_PITCH;
  const h = binHeight(params);
  return Math.sqrt(w * w + d * d + h * h) / 2;
}
