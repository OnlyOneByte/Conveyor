// Procedural Gridfinity preview geometry (ADR 0002: client-side, sub-ms, faithful
// approximation — NOT the manufacturing-exact STL).
//
// Dimensions and the two swept profiles below are lifted from the spec constants in
// scad/gridfinity-rebuilt-openscad/src/core/standard.scad, and are assembled the same
// way the library does it: a 2D profile SWEPT around a rounded-rectangle path. That
// keeps the chamfers as true angled surfaces and the corners as real fillets — an
// earlier version approximated the base with stacked boxes, which looked stepped.
import * as THREE from "three";

const GRID = 42; // GRID_DIMENSIONS_MM
const Z_UNIT = 7; // BASE_HEIGHT — also the height unit
const CELL = 41.5; // BASE_TOP_DIMENSIONS — leaves the spec's 0.5mm inter-cell gap
const GAP = GRID - CELL; // 0.5
const R_TOP = 7.5 / 2; // BASE_TOP_RADIUS (3.75)
const WALL_T = 1.2;
const ARC_SEGS = 12; // quads per 90° corner; corner radii are all ≤3.75mm

/** A swept-profile station: how far in from the footprint edge, and at what height. */
interface Section {
  inset: number;
  y: number;
}

// BASE_PROFILE = [[0,0], [0.8,0.8], [0.8,2.6], [2.95,4.75]] expressed as OUTWARD
// offset from the innermost bottom point; we carry it as inset from the footprint,
// i.e. inset = 2.95 - offset. The first and last points are short runs along the
// adjoining underside / body wall, present so those two edges can be rounded too.
const BASE_PROFILE_H = 4.75;
const BASE_PROFILE: Section[] = [
  { inset: 3.55, y: 0 }, // a little of the flat underside
  { inset: 2.95, y: 0 }, // innermost bottom point
  { inset: 2.15, y: 0.8 }, // up and out at 45°
  { inset: 2.15, y: 2.6 }, // straight up
  { inset: 0, y: BASE_PROFILE_H }, // up and out at 45°, to full footprint
  // A hair proud of the body wall and overlapping into the bridge above, so the top
  // edge has something to round into without leaving a coplanar seam.
  { inset: -0.01, y: BASE_PROFILE_H + 0.4 },
];

// STACKING_LIP = [[0,0], [0.7,0.7], [0.7,2.5], [2.6,4.4]] — the socket the next bin's
// feet drop into. Inset is measured from the bin's outer face, so this traces the lip's
// INNER surface. The spec's top point is a knife edge that it then fillets, so we keep a
// small flat there rather than a degenerate zero-width strip.
const LIP_H = 4.4; // STACKING_LIP_HEIGHT
const LIP_FILLET = 0.6; // STACKING_LIP_FILLET_RADIUS
const LIP_PROFILE: Section[] = [
  { inset: 2.6, y: 0 }, // deepest point of the ledge
  { inset: 1.9, y: 0.7 },
  { inset: 1.9, y: 2.5 },
  { inset: LIP_FILLET / 2, y: LIP_H },
];

const MAGNET_R = 6.5 / 2; // MAGNET_HOLE_RADIUS
const MAGNET_DEPTH = 2.4; // MAGNET_HOLE_DEPTH (MAGNET_HEIGHT + 2 layers)
// base_bottom_dimensions/2 - HOLE_DISTANCE_FROM_BOTTOM_EDGE = 35.6/2 - 4.8
const MAGNET_OFFSET = 13;

// Edge rounding applied to the swept profiles. The spec profiles are pure chamfers, so
// swept verbatim every junction is a hard crease and the base reads as folded cardboard.
// A real printed part has extrusion rounding at those edges; this reproduces it, and
// because the rounded profile is tangent-continuous the whole sweep can then be one
// smooth-shaded mesh (flats stay flat — averaging a tangent join changes nothing).
const EDGE_R = 0.4;
const EDGE_SEGS = 3;

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
  gridX: 2, gridY: 3, heightUnits: 6,
  divisionsX: 1, divisionsY: 1,
  scoop: false, labelTab: false, magnetHoles: false, stackingLip: true,
};

const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2dd4bf, roughness: 0.6, metalness: 0.05 });
const wallMat = new THREE.MeshStandardMaterial({ color: 0x14b8a6, roughness: 0.7, metalness: 0.05 });
const lipMat = new THREE.MeshStandardMaterial({ color: 0x5eead4, roughness: 0.5, metalness: 0.1 });
const tabMat = new THREE.MeshStandardMaterial({ color: 0x99f6e4, roughness: 0.5 });
// Bore interior. DoubleSide so the open-ended cylinder's far inner wall is visible when
// looking up into the pocket from below. These are much darker than the body on purpose:
// the scene has no ambient occlusion, so a 2.4mm pocket cannot self-shadow and would
// otherwise vanish into the surrounding surface. The floor is darker still, which is what
// gives the pocket read-able depth.
const boreWallMat = new THREE.MeshStandardMaterial({
  color: 0x0a2523, roughness: 1, side: THREE.DoubleSide,
});
const boreFloorMat = new THREE.MeshStandardMaterial({ color: 0x04100f, roughness: 1 });

/**
 * Closed rounded-rectangle ring in the XZ plane, walked counter-clockwise.
 * Point count is fixed at 4*(ARC_SEGS+1) regardless of radius, so any two rings can be
 * stitched 1:1 — that's what makes the sweep work.
 */
function ring(w: number, d: number, r: number): THREE.Vector2[] {
  const rr = Math.max(0.02, Math.min(r, Math.min(w, d) / 2 - 0.01));
  const hx = w / 2 - rr;
  const hz = d / 2 - rr;
  const corners: [number, number, number][] = [
    [hx, hz, 0],
    [-hx, hz, Math.PI / 2],
    [-hx, -hz, Math.PI],
    [hx, -hz, 1.5 * Math.PI],
  ];
  const pts: THREE.Vector2[] = [];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= ARC_SEGS; i++) {
      const a = a0 + (Math.PI / 2) * (i / ARC_SEGS);
      pts.push(new THREE.Vector2(cx + rr * Math.cos(a), cz + rr * Math.sin(a)));
    }
  }
  return pts;
}

function build(pos: Float32Array, idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function pack(a: THREE.Vector2[], ya: number, b: THREE.Vector2[], yb: number): Float32Array {
  const n = a.length;
  const pos = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = a[i].x; pos[i * 3 + 1] = ya; pos[i * 3 + 2] = a[i].y;
    const o = (n + i) * 3;
    pos[o] = b[i].x; pos[o + 1] = yb; pos[o + 2] = b[i].y;
  }
  return pos;
}

/**
 * One quad strip between two rings — a single band of the swept surface.
 * Each band is its own geometry on purpose: vertices are shared AROUND the ring (so
 * corner fillets shade smoothly) but not BETWEEN bands (so the 45° chamfer joins stay
 * crisp instead of being averaged into a blob).
 * `inward` flips the winding for surfaces seen from inside the bin.
 */
function band(
  a: THREE.Vector2[], ya: number, b: THREE.Vector2[], yb: number, inward: boolean,
): THREE.BufferGeometry {
  const n = a.length;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [ai, aj, bi, bj] = [i, j, n + i, n + j];
    if (inward) idx.push(ai, aj, bi, aj, bj, bi);
    else idx.push(ai, bi, aj, aj, bi, bj);
  }
  return build(pack(a, ya, b, yb), idx);
}

/** Flat ring-shaped face between two rings at the same height. */
function annulus(
  outer: THREE.Vector2[], inner: THREE.Vector2[], y: number, up: boolean,
): THREE.BufferGeometry {
  const n = outer.length;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [oi, oj, ii, ij] = [i, j, n + i, n + j];
    if (up) idx.push(oi, ij, oj, oi, ii, ij);
    else idx.push(oi, oj, ij, oi, ij, ii);
  }
  return build(pack(outer, y, inner, y), idx);
}

/** Solid rounded-rect face, triangulated as a fan from the centre. */
function face(r: THREE.Vector2[], y: number, up: boolean): THREE.BufferGeometry {
  const n = r.length;
  const pos = new Float32Array((n + 1) * 3);
  pos[0] = 0; pos[1] = y; pos[2] = 0;
  for (let i = 0; i < n; i++) {
    const o = (i + 1) * 3;
    pos[o] = r[i].x; pos[o + 1] = y; pos[o + 2] = r[i].y;
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (up) idx.push(0, j + 1, i + 1);
    else idx.push(0, i + 1, j + 1);
  }
  return build(pos, idx);
}

/**
 * The downward-facing underside of a foot, with the magnet bores punched OUT of it.
 * There is no CSG in this path, so without real holes here the solid face simply covers
 * the bore pockets and they are invisible from below. `ShapeGeometry` triangulates a
 * contour with holes, which is exactly what's needed.
 */
function undersideFace(
  r: THREE.Vector2[], y: number, bores: { x: number; z: number; radius: number }[],
): THREE.BufferGeometry {
  const shape = new THREE.Shape(r.map((p) => new THREE.Vector2(p.x, p.y)));
  for (const b of bores) {
    const hole = new THREE.Path();
    hole.absarc(b.x, b.z, b.radius, 0, Math.PI * 2, true); // clockwise => a hole
    shape.holes.push(hole);
  }
  const geo = new THREE.ShapeGeometry(shape, 20);
  // ShapeGeometry lies in XY facing +Z; this maps shape (x,y) -> world (x,z) and the
  // normal to -Y, i.e. pointing down.
  geo.rotateX(Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

/**
 * Round the interior vertices of a profile polyline with a constant radius, inserting
 * a tangent arc at each. Tangent length is clamped so an arc can never overrun a
 * neighbouring segment. The result is tangent-continuous, which is what lets the swept
 * surface be smooth-shaded as a single mesh.
 */
function roundProfile(profile: Section[], radius: number, segs: number): Section[] {
  if (profile.length < 3) return profile;
  const out: Section[] = [profile[0]];
  for (let i = 1; i < profile.length - 1; i++) {
    const a = profile[i - 1];
    const b = profile[i];
    const c = profile[i + 1];
    const len = (p: Section, q: Section) => Math.hypot(p.inset - q.inset, p.y - q.y);
    const unit = (p: Section, q: Section) => {
      const l = len(p, q) || 1;
      return { x: (p.inset - q.inset) / l, y: (p.y - q.y) / l };
    };
    const u = unit(a, b);
    const v = unit(c, b);
    const theta = Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y)));
    // Collinear or doubled-back: nothing meaningful to round.
    if (!Number.isFinite(theta) || theta > Math.PI - 1e-3 || theta < 1e-3) {
      out.push(b);
      continue;
    }
    const half = theta / 2;
    const t = Math.min(radius / Math.tan(half), len(a, b) * 0.45, len(c, b) * 0.45);
    const r = t * Math.tan(half);
    const bl = Math.hypot(u.x + v.x, u.y + v.y) || 1;
    const bis = { x: (u.x + v.x) / bl, y: (u.y + v.y) / bl };
    const ctr = { inset: b.inset + (bis.x * r) / Math.sin(half), y: b.y + (bis.y * r) / Math.sin(half) };
    const p1 = { inset: b.inset + u.x * t, y: b.y + u.y * t };
    const p2 = { inset: b.inset + v.x * t, y: b.y + v.y * t };
    const a1 = Math.atan2(p1.y - ctr.y, p1.inset - ctr.inset);
    const a2 = Math.atan2(p2.y - ctr.y, p2.inset - ctr.inset);
    let sweepAngle = a2 - a1;
    while (sweepAngle > Math.PI) sweepAngle -= 2 * Math.PI;
    while (sweepAngle < -Math.PI) sweepAngle += 2 * Math.PI;
    for (let k = 0; k <= segs; k++) {
      const ang = a1 + sweepAngle * (k / segs);
      out.push({ inset: ctr.inset + r * Math.cos(ang), y: ctr.y + r * Math.sin(ang) });
    }
  }
  out.push(profile[profile.length - 1]);
  return out;
}

/**
 * Sweep a profile around a rounded-rect footprint into a SINGLE smooth geometry.
 * Vertices are shared between bands so `computeVertexNormals` renders the rounded
 * junctions as real curvature; flats are unaffected because averaging across a tangent
 * join reproduces the same normal.
 */
function sweepSolid(
  profile: Section[], w: number, d: number, r: number, yBase: number,
  inward: boolean, capFirst: boolean, capLast: boolean,
): THREE.BufferGeometry {
  const rings = profile.map((s) => ring(w - 2 * s.inset, d - 2 * s.inset, r - s.inset));
  const ys = profile.map((s) => yBase + s.y);
  const n = rings[0].length;
  const verts: number[] = [];
  for (let k = 0; k < rings.length; k++) {
    for (let i = 0; i < n; i++) verts.push(rings[k][i].x, ys[k], rings[k][i].y);
  }
  const idx: number[] = [];
  for (let k = 0; k + 1 < rings.length; k++) {
    const a0 = k * n;
    const b0 = (k + 1) * n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [ai, aj, bi, bj] = [a0 + i, a0 + j, b0 + i, b0 + j];
      if (inward) idx.push(ai, aj, bi, aj, bj, bi);
      else idx.push(ai, bi, aj, aj, bi, bj);
    }
  }
  const addCap = (k: number, up: boolean) => {
    const c = verts.length / 3;
    verts.push(0, ys[k], 0);
    const base = k * n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (up) idx.push(c, base + j, base + i);
      else idx.push(c, base + i, base + j);
    }
  };
  if (capFirst) addCap(0, false);
  if (capLast) addCap(rings.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Rounded-edge versions of the two swept profiles, computed once at module load. */
const BASE_SWEEP = roundProfile(BASE_PROFILE, EDGE_R, EDGE_SEGS);
const LIP_SWEEP = roundProfile(LIP_PROFILE, LIP_FILLET / 2, EDGE_SEGS);

/** The ring a profile station traces on a given footprint. */
function ringAt(s: Section, w: number, d: number): THREE.Vector2[] {
  return ring(w - 2 * s.inset, d - 2 * s.inset, R_TOP - s.inset);
}

/** Overall height of a bin in mm (the stacking lip sits within it, per spec). */
export function binHeight(p: Partial<GridfinityPreviewParams> = {}): number {
  return Math.max({ ...DEFAULTS, ...p }.heightUnits, 2) * Z_UNIT;
}

/** Build a Gridfinity-bin approximation centered at the origin (Y up). */
export function buildGeometry(p: Partial<GridfinityPreviewParams> = {}): THREE.Group {
  const params = { ...DEFAULTS, ...p };
  const g = new THREE.Group();
  const { gridX: gx, gridY: gy } = params;

  const w = gx * GRID - GAP;
  const d = gy * GRID - GAP;
  const h = binHeight(params);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => g.add(new THREE.Mesh(geo, mat));

  // ── Base: one swept foot per grid cell, the spec's BASE_PROFILE with rounded edges.
  //    One mesh per foot, smooth-shaded — the rounded profile is tangent-continuous.
  //    The underside is a separate face so the magnet bores can be punched through it.
  const footBottom = ringAt(BASE_SWEEP[0], CELL, CELL);
  const boreOffsets: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  const bores = params.magnetHoles
    ? boreOffsets.map(([sx, sz]) => ({
        x: sx * MAGNET_OFFSET, z: sz * MAGNET_OFFSET, radius: MAGNET_R,
      }))
    : [];
  for (let cx = 0; cx < gx; cx++) {
    for (let cy = 0; cy < gy; cy++) {
      const ox = (cx - (gx - 1) / 2) * GRID;
      const oz = (cy - (gy - 1) / 2) * GRID;
      const foot = sweepSolid(BASE_SWEEP, CELL, CELL, R_TOP, 0, false, false, false);
      foot.translate(ox, 0, oz);
      add(foot, bodyMat);

      const under = undersideFace(footBottom, 0, bores);
      under.translate(ox, 0, oz);
      add(under, bodyMat);

      // A pocket per bore, seen through the hole punched in the face above.
      for (const b of bores) {
        const x = ox + b.x;
        const z = oz + b.z;
        const wall = new THREE.Mesh(
          new THREE.CylinderGeometry(MAGNET_R, MAGNET_R, MAGNET_DEPTH, 24, 1, true), boreWallMat,
        );
        wall.position.set(x, MAGNET_DEPTH / 2, z);
        g.add(wall);
        const floor = new THREE.Mesh(new THREE.CircleGeometry(MAGNET_R, 24), boreFloorMat);
        floor.rotation.x = Math.PI / 2; // CircleGeometry faces +Z; rotate it to face -Y
        floor.position.set(x, MAGNET_DEPTH, z);
        g.add(floor);
      }
    }
  }

  // ── Bridge: the slab that ties the feet together and forms the interior floor.
  const outer = ring(w, d, R_TOP);
  add(band(outer, BASE_PROFILE_H, outer, Z_UNIT, false), bodyMat);
  add(face(outer, BASE_PROFILE_H, false), bodyMat);
  add(face(outer, Z_UNIT, true), bodyMat);

  // ── Walls. With a stacking lip the lip owns the top LIP_H, so the walls stop there
  //    and the two meet back-to-back (touching faces point opposite ways, so they do
  //    not z-fight).
  const wallTop = params.stackingLip ? h - LIP_H : h;
  const innerR = ring(w - 2 * WALL_T, d - 2 * WALL_T, R_TOP - WALL_T);
  add(band(outer, Z_UNIT, outer, wallTop, false), wallMat);
  add(band(innerR, Z_UNIT, innerR, wallTop, true), wallMat);
  if (!params.stackingLip) add(annulus(outer, innerR, wallTop, true), wallMat);

  // ── Stacking lip: the spec's swept socket profile, edges rounded.
  if (params.stackingLip) {
    const yb = h - LIP_H;
    add(sweepSolid(LIP_SWEEP, w, d, R_TOP, yb, true, false, false), lipMat);
    add(band(outer, yb, outer, h, false), lipMat); // outer face, flush with the walls
    add(annulus(outer, ringAt(LIP_SWEEP[0], w, d), yb, false), lipMat); // ledge underside
    add(annulus(outer, ringAt(LIP_SWEEP[LIP_SWEEP.length - 1], w, d), h, true), lipMat); // top flat
  }

  // ── Interior dividers.
  const innerW = w - 2 * WALL_T;
  const innerD = d - 2 * WALL_T;
  const cavityH = wallTop - Z_UNIT;
  const cavityY = Z_UNIT + cavityH / 2;
  for (let i = 1; i < params.divisionsX; i++) {
    const x = -innerW / 2 + (innerW / params.divisionsX) * i;
    const m = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, cavityH, innerD), wallMat);
    m.position.set(x, cavityY, 0);
    g.add(m);
  }
  for (let j = 1; j < params.divisionsY; j++) {
    const z = -innerD / 2 + (innerD / params.divisionsY) * j;
    const m = new THREE.Mesh(new THREE.BoxGeometry(innerW, cavityH, WALL_T), wallMat);
    m.position.set(0, cavityY, z);
    g.add(m);
  }

  // Label tab — a small angled shelf along the back-top of the first compartment.
  if (params.labelTab) {
    const tabW = innerW / params.divisionsX - 1;
    const tab = new THREE.Mesh(new THREE.BoxGeometry(tabW, 1.2, 10), tabMat);
    tab.position.set(-innerW / 2 + tabW / 2 + 0.5, wallTop - 1, -innerD / 2 + 6);
    tab.rotation.x = -0.5;
    g.add(tab);
  }

  // Scoop — a quarter-cylinder ramp along the front interior floor.
  if (params.scoop) {
    const r = Math.min(10, innerD / 2);
    const scoopGeo = new THREE.CylinderGeometry(r, r, innerW, 32, 1, false, 0, Math.PI / 2);
    const scoop = new THREE.Mesh(scoopGeo, wallMat);
    scoop.rotation.z = Math.PI / 2;
    scoop.position.set(0, Z_UNIT + r, d / 2 - WALL_T - r);
    g.add(scoop);
  }

  // Recenter vertically so the model sits nicely in frame.
  g.position.y = -h / 2;
  return g;
}

/** Longest horizontal extent — lets the camera/controls frame any bin size. */
export function boundingRadius(p: Partial<GridfinityPreviewParams> = {}): number {
  const params = { ...DEFAULTS, ...p };
  const w = params.gridX * GRID;
  const d = params.gridY * GRID;
  const h = binHeight(params);
  return Math.sqrt(w * w + d * d + h * h) / 2;
}
