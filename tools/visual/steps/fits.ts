import { type StepRunner, wrongKind } from "../step.ts";

interface Box {
  getBoundingClientRect(): { right: number };
  ownerDocument: { documentElement: { scrollWidth: number; clientWidth: number } };
}

declare module "../step.ts" {
  interface StepKinds {
    fits: { fits: string };
  }
}

export const step: StepRunner = {
  kind: "fits",
  run: async (page, step) => {
    if (!("fits" in step)) throw wrongKind("fits", step);
    const target = page.locator(step.fits).first();
    await target.waitFor({ timeout: 5000 });
    const { right, wide, width } = await target.evaluate((el: Box) => ({
      right: Math.ceil(el.getBoundingClientRect().right),
      wide: el.ownerDocument.documentElement.scrollWidth,
      width: el.ownerDocument.documentElement.clientWidth,
    }));
    if (right > width || wide > width)
      throw new Error(
        `${step.fits} overflows the ${width} px viewport: its right edge is at ${right} px and the page is ${wide} px wide`,
      );
  },
};
