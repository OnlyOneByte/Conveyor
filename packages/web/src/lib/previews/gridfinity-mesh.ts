import * as THREE from "three";

export const QUADS_PER_CORNER = 12;

export interface Section {
  inset: number;
  y: number;
}

export function ring(w: number, d: number, r: number): THREE.Vector2[] {
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
    for (let i = 0; i <= QUADS_PER_CORNER; i++) {
      const a = a0 + (Math.PI / 2) * (i / QUADS_PER_CORNER);
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
    pos[i * 3] = a[i].x;
    pos[i * 3 + 1] = ya;
    pos[i * 3 + 2] = a[i].y;
    const o = (n + i) * 3;
    pos[o] = b[i].x;
    pos[o + 1] = yb;
    pos[o + 2] = b[i].y;
  }
  return pos;
}

export function band(
  a: THREE.Vector2[],
  ya: number,
  b: THREE.Vector2[],
  yb: number,
  inward: boolean,
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

export function annulus(
  outer: THREE.Vector2[],
  inner: THREE.Vector2[],
  y: number,
  up: boolean,
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

export function face(r: THREE.Vector2[], y: number, up: boolean): THREE.BufferGeometry {
  const n = r.length;
  const pos = new Float32Array((n + 1) * 3);
  pos[0] = 0;
  pos[1] = y;
  pos[2] = 0;
  for (let i = 0; i < n; i++) {
    const o = (i + 1) * 3;
    pos[o] = r[i].x;
    pos[o + 1] = y;
    pos[o + 2] = r[i].y;
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (up) idx.push(0, j + 1, i + 1);
    else idx.push(0, i + 1, j + 1);
  }
  return build(pos, idx);
}

export function undersideFace(
  r: THREE.Vector2[],
  y: number,
  bores: { x: number; z: number; radius: number }[],
): THREE.BufferGeometry {
  const shape = new THREE.Shape(r.map((p) => new THREE.Vector2(p.x, p.y)));
  for (const b of bores) {
    const hole = new THREE.Path();
    hole.absarc(b.x, b.z, b.radius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const geo = new THREE.ShapeGeometry(shape, 20);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

export function roundProfile(profile: Section[], radius: number, segs: number): Section[] {
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
    if (!Number.isFinite(theta) || theta > Math.PI - 1e-3 || theta < 1e-3) {
      out.push(b);
      continue;
    }
    const half = theta / 2;
    const t = Math.min(radius / Math.tan(half), len(a, b) * 0.45, len(c, b) * 0.45);
    const r = t * Math.tan(half);
    const bl = Math.hypot(u.x + v.x, u.y + v.y) || 1;
    const bis = { x: (u.x + v.x) / bl, y: (u.y + v.y) / bl };
    const ctr = {
      inset: b.inset + (bis.x * r) / Math.sin(half),
      y: b.y + (bis.y * r) / Math.sin(half),
    };
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

export function sweepSolid(
  profile: Section[],
  w: number,
  d: number,
  r: number,
  yBase: number,
  inward: boolean,
  capFirst: boolean,
  capLast: boolean,
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
