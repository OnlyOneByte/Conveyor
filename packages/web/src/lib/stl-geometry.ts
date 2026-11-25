import type { ParsedStl } from "./parse-stl.js";

const FACE_BYTES = 50;
const SOLID = [115, 111, 108, 105, 100];
const FLOAT = /[\s]+([+-]?(?:\d*)(?:\.\d*)?(?:[eE][+-]?\d+)?)/.source;
const VERTEX = new RegExp(`vertex${FLOAT}${FLOAT}${FLOAT}`, "g");

function isBinary(view: DataView): boolean {
  if (view.byteLength < 84) return false;
  if (84 + view.getUint32(80, true) * FACE_BYTES === view.byteLength) return true;
  for (let offset = 0; offset < 5; offset++)
    if (SOLID.every((byte, i) => view.getUint8(offset + i) === byte)) return false;
  return true;
}

function binaryPositions(view: DataView): Float32Array {
  const faces = Math.min(view.getUint32(80, true), Math.floor((view.byteLength - 84) / FACE_BYTES));
  const out = new Float32Array(faces * 9);
  for (let face = 0; face < faces; face++) {
    const start = 84 + face * FACE_BYTES + 12;
    for (let i = 0; i < 9; i++) out[face * 9 + i] = view.getFloat32(start + i * 4, true);
  }
  return out;
}

function asciiPositions(buffer: ArrayBuffer): Float32Array {
  const text = new TextDecoder().decode(buffer);
  const values: number[] = [];
  for (const match of text.matchAll(VERTEX))
    values.push(Number(match[1]), Number(match[2]), Number(match[3]));
  return new Float32Array(values.slice(0, values.length - (values.length % 9)));
}

function centre(position: Float32Array): number {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.length; i++) {
    const axis = i % 3;
    const value = position[i] ?? 0;
    if (value < (min[axis] ?? 0)) min[axis] = value;
    if (value > (max[axis] ?? 0)) max[axis] = value;
  }
  const mid = min.map((low, axis) => (low + (max[axis] ?? 0)) / 2);
  let far = 0;
  for (let i = 0; i < position.length; i += 3) {
    let distance = 0;
    for (let axis = 0; axis < 3; axis++) {
      const value = (position[i + axis] ?? 0) - (mid[axis] ?? 0);
      position[i + axis] = value;
      distance += value * value;
    }
    if (distance > far) far = distance;
  }
  return Math.sqrt(far);
}

function faceNormals(position: Float32Array): Float32Array {
  const normal = new Float32Array(position.length);
  const at = (i: number) => position[i] ?? 0;
  for (let i = 0; i < position.length; i += 9) {
    const cbx = at(i + 6) - at(i + 3);
    const cby = at(i + 7) - at(i + 4);
    const cbz = at(i + 8) - at(i + 5);
    const abx = at(i) - at(i + 3);
    const aby = at(i + 1) - at(i + 4);
    const abz = at(i + 2) - at(i + 5);
    const x = cby * abz - cbz * aby;
    const y = cbz * abx - cbx * abz;
    const z = cbx * aby - cby * abx;
    const length = Math.hypot(x, y, z) || 1;
    for (let corner = 0; corner < 9; corner += 3) {
      normal[i + corner] = x / length;
      normal[i + corner + 1] = y / length;
      normal[i + corner + 2] = z / length;
    }
  }
  return normal;
}

export function stlGeometry(buffer: ArrayBuffer): ParsedStl | null {
  const view = new DataView(buffer);
  const position = isBinary(view) ? binaryPositions(view) : asciiPositions(buffer);
  if (position.length === 0) return null;
  const radius = centre(position);
  return { position, normal: faceNormals(position), radius };
}
