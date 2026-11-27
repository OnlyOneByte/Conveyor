import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    stays: { stays: string; until: string };
  }
}

const LIMIT_MS = 15_000;
const SETTLE_MS = 600;

export const step: StepRunner = {
  kind: "stays",
  run: async (page, step) => {
    if (!("stays" in step)) throw wrongKind("stays", step);
    const target = page.locator(step.stays).first();
    const start = await target.boundingBox();
    if (!start) throw new Error(`stays: ${step.stays} isn't on the page`);
    const deadline = Date.now() + LIMIT_MS;
    let settleAt = 0;
    while (Date.now() < deadline) {
      const box = await target.boundingBox();
      const moved = box ? Math.abs(box.y - start.y) : Number.POSITIVE_INFINITY;
      if (moved > 1) {
        const now = box ? `${Math.round(box.y)} px` : "gone";
        throw new Error(`stays: ${step.stays} moved from ${Math.round(start.y)} px to ${now}`);
      }
      if (!settleAt && (await page.locator(step.until).count())) settleAt = Date.now() + SETTLE_MS;
      if (settleAt && Date.now() >= settleAt) return;
      await page.waitForTimeout(40);
    }
    throw new Error(`stays: ${step.until} never appeared within ${LIMIT_MS} ms`);
  },
};
