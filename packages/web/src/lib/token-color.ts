import type { Theme } from "./preferences";

export function tokenColor(name: string, _theme: Theme): number {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0;
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name);
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return (r << 16) | (g << 8) | b;
}
