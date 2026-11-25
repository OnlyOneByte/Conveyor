import { type StepRunner, wrongKind } from "../step.ts";

interface Paint {
  fillStyle: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> };
}

interface Styled {
  parentElement: Styled | null;
  style: { color: string };
  width: number;
  height: number;
  ownerDocument: {
    createElement(tag: string): Styled;
    defaultView: { getComputedStyle(el: Styled): { color: string } } | null;
  };
  getContext(type: "2d", options: { willReadFrequently: boolean }): Paint | null;
  append(child: Styled): void;
  remove(): void;
}

declare module "../step.ts" {
  interface StepKinds {
    notColour: { notColour: string; token: string };
  }
}

const TOLERANCE = 16;

export const step: StepRunner = {
  kind: "notColour",
  run: async (page, step) => {
    if (!("notColour" in step)) throw wrongKind("notColour", step);
    const target = page.locator(step.notColour).first();
    await target.waitFor({ timeout: 5000 });
    const { own, token, ownRgb, tokenRgb } = await target.evaluate((el: Styled, name: string) => {
      const doc = el.ownerDocument;
      const view = doc.defaultView;
      const probe = doc.createElement("span");
      probe.style.color = `var(${name})`;
      (el.parentElement ?? el).append(probe);
      const resolved = view?.getComputedStyle(probe).color ?? "";
      probe.remove();
      const canvas = doc.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const paint = canvas.getContext("2d", { willReadFrequently: true });
      const rgb = (colour: string) => {
        if (!paint) return [];
        paint.fillStyle = "#000";
        paint.fillStyle = colour;
        paint.fillRect(0, 0, 1, 1);
        return Array.from(paint.getImageData(0, 0, 1, 1).data).slice(0, 3);
      };
      const mine = view?.getComputedStyle(el).color ?? "";
      return { own: mine, token: resolved, ownRgb: rgb(mine), tokenRgb: rgb(resolved) };
    }, step.token);
    if (ownRgb.length !== 3 || tokenRgb.length !== 3)
      throw new Error(`${step.notColour}: couldn't read ${own} or ${step.token} (${token})`);
    const gap = Math.max(...ownRgb.map((channel, i) => Math.abs(channel - (tokenRgb[i] ?? 0))));
    if (gap <= TOLERANCE)
      throw new Error(
        `${step.notColour} is drawn in ${step.token} or near it: ${own} is within ${gap}/255 of ${token}`,
      );
  },
};
