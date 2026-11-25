import type { Page } from "playwright";
import { PNG } from "pngjs";

export const RING_RATIO = 3;
export const RING_SHARE = 0.9;
export const RING_PAD = 6;
export const BEYOND = 3;

interface Scroller {
  scrollTop: number;
  focus(): void;
  blur(): void;
}

declare const document: {
  activeElement: Scroller | null;
  querySelector(selector: string): Scroller | null;
};

export const KEY_STEP_MS = 5000;

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
    ...xs.map((x): Point[] => [
      [x, top],
      [x, top - 1],
    ]),
    ...xs.map((x): Point[] => [
      [x, bottom],
      [x, bottom + 1],
    ]),
    ...ys.map((y): Point[] => [
      [left, y],
      [left - 1, y],
    ]),
    ...ys.map((y): Point[] => [
      [right, y],
      [right + 1, y],
    ]),
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

const beyond = (box: Box, [x, y]: Point): Point => {
  if (y < box.y) return [x, y - BEYOND];
  if (y >= box.y + box.height) return [x, y + BEYOND];
  return x < box.x ? [x - BEYOND, y] : [x + BEYOND, y];
};

export function ringShown(shot: PNG, box: Box): number {
  const band = ringBand(box);
  const stands = (p: Point) =>
    contrast(luminance(shot, p), luminance(shot, beyond(box, p))) >= RING_RATIO;
  return band.length ? band.filter((pair) => pair.some(stands)).length / band.length : 0;
}

const around = (found: Box) => ({
  x: Math.floor(found.x) - RING_PAD,
  y: Math.floor(found.y) - RING_PAD,
  width: Math.ceil(found.width) + 2 * RING_PAD + 1,
  height: Math.ceil(found.height) + 2 * RING_PAD + 1,
});

export async function assertNoRing(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  await target.tap();
  await Bun.sleep(300);
  const found = await target.boundingBox();
  if (!found) throw new Error(`noRing ${selector}: not on the page`);
  const clip = around(found);
  const shot = PNG.sync.read(await page.screenshot({ clip }));
  const share = ringShown(shot, { ...found, x: found.x - clip.x, y: found.y - clip.y });
  if (share < 1 - RING_SHARE) return;
  const shown = Math.round(share * 100);
  throw new Error(
    `noRing ${selector}: after a tap, ${shown}% of the pixels just outside it stand out 3:1 from the pixels beyond them; under ${Math.round((1 - RING_SHARE) * 100)}% may`,
  );
}

export async function assertRing(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await Bun.sleep(300);
  const found = await target.boundingBox();
  if (!found) throw new Error(`ring ${selector}: not on the page`);
  const clip = around(found);
  const shot = async () => PNG.sync.read(await page.screenshot({ clip }));
  const rest = await shot();
  await target.hover();
  await Bun.sleep(300);
  const hover = await shot();
  const box = { ...found, x: found.x - clip.x, y: found.y - clip.y };
  const problem = ringProblem(rest, hover, box);
  if (problem) throw new Error(`ring ${selector}: ${problem}`);
}

export function focusRingProblem(rest: PNG, focused: PNG, box: Box): string | null {
  const inset = 12;
  const [left, top] = [Math.floor(box.x), Math.floor(box.y)];
  const [right, bottom] = [Math.ceil(box.x + box.width) - 1, Math.ceil(box.y + box.height) - 1];
  const depths = span(1, RING_PAD + 1);
  const xs = span(left + inset, right - inset);
  const ys = span(top + inset, bottom - inset);
  const lines: Point[][] = [
    ...xs.map((x) => depths.map((d): Point => [x, top - d])),
    ...xs.map((x) => depths.map((d): Point => [x, bottom + d])),
    ...ys.map((y) => depths.map((d): Point => [left - d, y])),
    ...ys.map((y) => depths.map((d): Point => [right + d, y])),
  ];
  if (lines.length === 0) return "the target has no edge to sample";
  const changes = (p: Point) => contrast(luminance(rest, p), luminance(focused, p)) >= RING_RATIO;
  const ringed = (line: Point[]) =>
    line.some((p, i) => i > 0 && changes(p) && changes(line[i - 1] ?? p));
  const share = lines.filter(ringed).length / lines.length;
  if (share >= RING_SHARE) return null;
  return `focus shows a ${RING_RATIO}:1 ring at least 2 px thick within ${RING_PAD} px along ${Math.round(share * 100)}% of its edge; ${RING_SHARE * 100}% must`;
}

export async function assertKeyScrolls(page: Page, selector: string): Promise<void> {
  const fail = (why: string) => new Error(`keyScrolls ${selector}: ${why}`);
  const within = async <T>(what: string, call: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(fail(`${what} gave no answer within ${KEY_STEP_MS} ms`)),
        KEY_STEP_MS,
      );
    });
    try {
      return await Promise.race([call, late]);
    } finally {
      clearTimeout(timer);
    }
  };
  const read = (when: string) =>
    within(
      `reading the target ${when}`,
      page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? { focused: el === document.activeElement, top: el.scrollTop } : null;
      }, selector),
    );
  const start = await read("before PageDown");
  if (!start) throw fail("not on the page");
  if (!start.focused) throw fail("it doesn't have focus; tabTo it first");
  await Bun.sleep(300);
  const found = await within(
    "its box",
    page.locator(selector).first().boundingBox({ timeout: KEY_STEP_MS }),
  );
  if (!found) throw fail("not on the page");
  const clip = around(found);
  const shot = async () =>
    PNG.sync.read(await within("a screenshot", page.screenshot({ clip, timeout: KEY_STEP_MS })));
  const focused = await shot();
  await within("PageDown", page.keyboard.press("PageDown"));
  await Bun.sleep(300);
  const after = (await read("after PageDown"))?.top ?? start.top;
  await within(
    "blurring it",
    page.evaluate(() => document.activeElement?.blur()),
  );
  await Bun.sleep(300);
  const rest = await shot();
  await within(
    "focusing it again",
    page.evaluate((sel) => document.querySelector(sel)?.focus(), selector),
  );
  const problem = focusRingProblem(rest, focused, {
    ...found,
    x: found.x - clip.x,
    y: found.y - clip.y,
  });
  if (problem) throw fail(problem);
  if (after <= start.top) throw fail(`PageDown left it at scrollTop ${after} (was ${start.top})`);
}
