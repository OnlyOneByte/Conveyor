import type { Page } from "playwright";
import { messageOf } from "./errors.ts";

export const SCROLL_TIMEOUT_MS = 15000;

const WATCH_FRAMES = 30;

declare const requestAnimationFrame: (run: (time: number) => void) => number;
declare const scrollY: number;

interface Target {
  isConnected: boolean;
  getBoundingClientRect(): { top: number; left: number; height: number };
}

export interface Position {
  top: number;
  left: number;
  height: number;
  scrollY: number;
  connected: boolean;
}

const span = (values: number[]) => {
  const low = Math.round(Math.min(...values));
  const high = Math.round(Math.max(...values));
  return low === high ? `${low}` : `${low}..${high}`;
};

export function describeMotion(frames: Position[]): string {
  if (frames.length === 0) return "no animation frame ran in 1 s";
  const moved = new Set(frames.map((f) => `${f.top},${f.left},${f.height}`)).size;
  const parts = [
    `${frames.length} frames`,
    `${moved} positions`,
    `top ${span(frames.map((f) => f.top))}`,
    `left ${span(frames.map((f) => f.left))}`,
    `height ${span(frames.map((f) => f.height))}`,
    `scrollY ${span(frames.map((f) => f.scrollY))}`,
  ];
  if (frames.some((f) => !f.connected)) parts.push("detached");
  return parts.join(", ");
}

async function watch(page: Page, selector: string): Promise<string> {
  try {
    const frames = await page
      .locator(selector)
      .first()
      .evaluate(
        (target: Target, count) =>
          new Promise<Position[]>((done) => {
            const seen: Position[] = [];
            const stop = setTimeout(() => done(seen), 1000);
            const tick = () => {
              const box = target.getBoundingClientRect();
              seen.push({
                top: box.top,
                left: box.left,
                height: box.height,
                scrollY,
                connected: target.isConnected,
              });
              if (seen.length < count) requestAnimationFrame(tick);
              else {
                clearTimeout(stop);
                done(seen);
              }
            };
            requestAnimationFrame(tick);
          }),
        WATCH_FRAMES,
        { timeout: 3000 },
      );
    return describeMotion(frames);
  } catch (err) {
    return `could not watch the target: ${messageOf(err)}`;
  }
}

export async function scrollTo(page: Page, selector: string): Promise<void> {
  try {
    await page.locator(selector).first().scrollIntoViewIfNeeded({ timeout: SCROLL_TIMEOUT_MS });
  } catch (err) {
    throw new Error(`${messageOf(err)} (target over 1 s: ${await watch(page, selector)})`);
  }
}
