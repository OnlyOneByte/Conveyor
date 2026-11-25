import { type StepRunner, wrongKind } from "../step.ts";

interface Text {
  getBoundingClientRect(): { height: number };
  ownerDocument: {
    defaultView: { getComputedStyle(el: Text): { lineHeight: string; fontSize: string } } | null;
  };
}

declare module "../step.ts" {
  interface StepKinds {
    lines: { lines: string; max: number };
  }
}

export const step: StepRunner = {
  kind: "lines",
  run: async (page, step) => {
    if (!("lines" in step)) throw wrongKind("lines", step);
    const target = page.locator(step.lines).first();
    await target.waitFor({ timeout: 5000 });
    const { height, line } = await target.evaluate((el: Text) => {
      const style = el.ownerDocument.defaultView?.getComputedStyle(el);
      const px = Number.parseFloat(style?.lineHeight ?? "");
      return {
        height: el.getBoundingClientRect().height,
        line: Number.isFinite(px) ? px : Number.parseFloat(style?.fontSize ?? "16") * 1.2,
      };
    });
    const shown = Math.round(height / line);
    if (shown > step.max)
      throw new Error(
        `${step.lines} shows ${shown} lines (${Math.round(height)} px at ${line} px a line), more than ${step.max}`,
      );
  },
};
