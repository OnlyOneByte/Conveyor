export interface Size {
  x: number;
  y: number;
  z: number;
}

export const MAX_MEASURED_BYTES = 256 * 1024 * 1024;
const HEADER = 80;
const TRIANGLE = 50;

class Bounds {
  min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  seen = 0;
  broken = false;

  add(x: number, y: number, z: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      this.broken = true;
      return;
    }
    const point = [x, y, z];
    for (let i = 0; i < 3; i++) {
      this.min[i] = Math.min(this.min[i] ?? 0, point[i] ?? 0);
      this.max[i] = Math.max(this.max[i] ?? 0, point[i] ?? 0);
    }
    this.seen++;
  }

  size(): Size | null {
    if (this.broken || this.seen < 3) return null;
    const [x, y, z] = this.max.map((top, i) => top - (this.min[i] ?? 0));
    return { x: x ?? 0, y: y ?? 0, z: z ?? 0 };
  }
}

function binary(view: DataView, count: number): Size | null {
  const bounds = new Bounds();
  for (let t = 0; t < count && !bounds.broken; t++) {
    const at = HEADER + 4 + t * TRIANGLE + 12;
    for (let v = 0; v < 3; v++) {
      const o = at + v * 12;
      bounds.add(
        view.getFloat32(o, true),
        view.getFloat32(o + 4, true),
        view.getFloat32(o + 8, true),
      );
    }
  }
  return bounds.size();
}

function ascii(text: string): Size | null {
  const bounds = new Bounds();
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) {
    bounds.add(Number(m[1]), Number(m[2]), Number(m[3]));
    if (bounds.broken) break;
  }
  return bounds.size();
}

export function stlSize(buffer: ArrayBuffer, limit = MAX_MEASURED_BYTES): Size | null {
  if (buffer.byteLength > limit) return null;
  const view = new DataView(buffer);
  if (buffer.byteLength >= HEADER + 4) {
    const count = view.getUint32(HEADER, true);
    if (HEADER + 4 + count * TRIANGLE === buffer.byteLength) return binary(view, count);
  }
  return ascii(new TextDecoder().decode(buffer));
}

export type Fit =
  | { kind: "fits" }
  | { kind: "turned" }
  | { kind: "over"; sides: ("wide" | "deep" | "tall")[] };

export function fitOnBed(model: Size, bed: Size): Fit {
  const tall = model.z > bed.z;
  const flat = model.x <= bed.x && model.y <= bed.y;
  const turned = model.y <= bed.x && model.x <= bed.y;
  if (!tall && flat) return { kind: "fits" };
  if (!tall && turned) return { kind: "turned" };
  const sides: ("wide" | "deep" | "tall")[] = [];
  if (model.x > bed.x) sides.push("wide");
  if (model.y > bed.y) sides.push("deep");
  if (tall) sides.push("tall");
  return { kind: "over", sides };
}

const AXIS = { wide: "x", deep: "y", tall: "z" } as const;

export const overBy = (model: Size, bed: Size, sides: readonly (keyof typeof AXIS)[]) =>
  sides.map((s) => `${mm(model[AXIS[s]])} mm ${s} (the bed takes ${mm(bed[AXIS[s]])})`).join(", ");

export const INCH = 25.4;
export const TINY_MM = 3;

export const inches = (s: Size): Size => ({ x: s.x * INCH, y: s.y * INCH, z: s.z * INCH });

export function looksInInches(model: Size, bed?: Size): boolean {
  const largest = Math.max(model.x, model.y, model.z);
  if (largest === 0 || largest >= TINY_MM) return false;
  return !bed || fitOnBed(inches(model), bed).kind !== "over";
}

const round = (n: number) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
export const mm = (n: number) => `${round(n)}`;
export const sizeLine = (s: Size) => `${mm(s.x)} × ${mm(s.y)} × ${mm(s.z)} mm`;
