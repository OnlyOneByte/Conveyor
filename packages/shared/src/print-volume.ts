export interface PrintVolume {
  x: number;
  y: number;
  z: number;
}

const POINT = /^\s*(-?\d+(?:\.\d+)?)\s*x\s*(-?\d+(?:\.\d+)?)\s*$/i;

function volume(points: readonly string[], height: string | undefined): PrintVolume | null {
  const xy = points.map((p) => POINT.exec(p)).filter((m) => m !== null);
  const z = Number(height);
  if (xy.length < 3 || xy.length !== points.length || !(z > 0)) return null;
  const xs = xy.map((m) => Number(m[1]));
  const ys = xy.map((m) => Number(m[2]));
  const x = Math.max(...xs) - Math.min(...xs);
  const y = Math.max(...ys) - Math.min(...ys);
  return x > 0 && y > 0 && Number.isFinite(z) ? { x, y, z } : null;
}

export function orcaPrintVolume(machine: string): PrintVolume | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(machine);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { printable_area: area, printable_height: height } = Object.fromEntries(
    Object.entries(parsed),
  );
  if (!Array.isArray(area) || !area.every((p) => typeof p === "string")) return null;
  return volume(
    area,
    typeof height === "string" || typeof height === "number" ? String(height) : undefined,
  );
}

export function prusaPrintVolume(config: string): PrintVolume | null {
  const value = (key: string) =>
    new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`, "m").exec(config)?.[1];
  const shape = value("bed_shape");
  if (!shape) return null;
  return volume(shape.split(","), value("max_print_height"));
}
