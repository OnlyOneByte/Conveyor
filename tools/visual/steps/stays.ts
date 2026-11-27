import { type StepRunner, wrongKind } from "../step.ts";
import { release } from "./stall.ts";

declare module "../step.ts" {
  interface StepKinds {
    stays: { stays: string[]; until: string; releasing?: string };
  }
}

const LIMIT_MS = 15_000;
const SETTLE_MS = 600;

export const step: StepRunner = {
  kind: "stays",
  run: async (page, step) => {
    if (!("stays" in step)) throw wrongKind("stays", step);
    const targets = step.stays.map((selector) => ({
      selector,
      at: page.locator(selector).first(),
    }));
    const tops = async () =>
      Promise.all(targets.map(async ({ at }) => (await at.boundingBox())?.y));
    const start = await tops();
    start.forEach((top, i) => {
      if (top === undefined) throw new Error(`stays: ${step.stays[i]} isn't on the page`);
    });
    if (step.releasing && release(page, step.releasing) === null)
      throw new Error(`stays: no stall step names ${step.releasing}`);
    const deadline = Date.now() + LIMIT_MS;
    let settleAt = 0;
    while (Date.now() < deadline) {
      const now = await tops();
      now.forEach((top, i) => {
        const from = start[i] ?? 0;
        if (top !== undefined && Math.abs(top - from) <= 1) return;
        const to = top === undefined ? "gone" : `${Math.round(top)} px`;
        throw new Error(`stays: ${step.stays[i]} moved from ${Math.round(from)} px to ${to}`);
      });
      if (!settleAt && (await page.locator(step.until).count())) settleAt = Date.now() + SETTLE_MS;
      if (settleAt && Date.now() >= settleAt) return;
      await page.waitForTimeout(40);
    }
    throw new Error(`stays: ${step.until} never appeared within ${LIMIT_MS} ms`);
  },
};
