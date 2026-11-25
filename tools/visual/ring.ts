import { PNG } from "pngjs";
import type { Page } from "playwright";

export const RING_RATIO = 3;
export const RING_SHARE = 0.9;
export const RING_PAD = 6;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Point = [number, number];

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function luminance(png: PNG, [x, y]: Point): number {
  const i = (y * png.width + x) * 4;
  const [r = 0, g = 0, b = 0] = png.data.subarray(i, i + 3);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const span = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);

export function ringBand(box: Box): Point[][] {
  const left = Math.floor(box.x) - 1;
  const right = Math.ceil(box.x + box.width);
  const top = Math.floor(box.y) - 1;
  const bottom = Math.ceil(box.y + box.height);
  const inset = Math.ceil(Math.min(box.height / 2, 12));
  const across = Math.round(box.height / 3);
  const xs = span(Math.ceil(box.x) + inset, Math.floor(box.x + box.width) - inset);
  const ys = span(Math.ceil(box.y) + across, Math.floor(box.y + box.height) - across);
  return [
    ...xs.map((x): Point[] => [[x, top], [x, top - 1]]),
    ...xs.map((x): Point[] => [[x, bottom], [x, bottom + 1]]),
    ...ys.map((y): Point[] => [[left, y], [left - 1, y]]),
    ...ys.map((y): Point[] => [[right, y], [right + 1, y]]),
  ];
}

export function ringProblem(rest: PNG, hover: PNG, box: Box): string | null {
  const band = ringBand(box);
  if (band.length === 0) return "the target has no edge to sample";
  const ratios = band.map((pair) =>
    Math.max(...pair.map((p) => contrast(luminance(rest, p), luminance(hover, p)))),
  );
  const share = ratios.filter((r) => r >= RING_RATIO).length / ratios.length;
  if (share >= RING_SHARE) return null;
  const lowest = Math.min(...ratios).toFixed(2);
  return `${Math.round(share * 100)}% of the pixels just outside it change by ${RING_RATIO}:1 on hover (lowest ${lowest}:1); ${RING_SHARE * 100}% must`;
}

export async function assertRing(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await Bun.sleep(300);
  const found = await target.boundingBox();
  if (!found) throw new Error(`ring ${selector}: not on the page`);
  const clip = {
    x: Math.floor(found.x) - RING_PAD,
    y: Math.floor(found.y) - RING_PAD,
    width: Math.ceil(found.width) + 2 * RING_PAD + 1,
    height: Math.ceil(found.height) + 2 * RING_PAD + 1,
  };
  const shot = async () => PNG.sync.read(await page.screenshot({ clip }));
  const rest = await shot();
  await target.hover();
  await Bun.sleep(300);
  const hover = await shot();
  const box = { ...found, x: found.x - clip.x, y: found.y - clip.y };
  const problem = ringProblem(rest, hover, box);
  if (problem) throw new Error(`ring ${selector}: ${problem}`);
}
