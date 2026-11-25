import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    doubleClicks: { doubleClicks: string; across: readonly number[]; reset: string };
  }
}

const SETTLE_MS = 700;

export const step: StepRunner = {
  kind: "doubleClicks",
  run: async (page, step) => {
    if (!("doubleClicks" in step)) throw wrongKind("doubleClicks", step);
    const sent: string[] = [];
    const watch = (request: { method(): string; url(): string }) => {
      if (request.method() !== "GET")
        sent.push(`${request.method()} ${new URL(request.url()).pathname}`);
    };
    page.on("request", watch);
    try {
      for (const share of step.across) {
        const target = page.locator(step.doubleClicks).first();
        const box = await target.boundingBox();
        if (!box) throw new Error(`doubleClicks ${step.doubleClicks}: not on the page`);
        await page.mouse.dblclick(box.x + box.width * share, box.y + box.height / 2);
        await page.waitForTimeout(SETTLE_MS);
        if (sent.length)
          throw new Error(
            `doubleClicks ${step.doubleClicks} at ${Math.round(share * 100)}% across sent ${sent.join(", ")}`,
          );
        await page.locator(step.reset).first().click();
      }
    } finally {
      page.off("request", watch);
    }
  },
};
