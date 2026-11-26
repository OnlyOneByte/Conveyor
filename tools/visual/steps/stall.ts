import type { Page } from "playwright";
import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    stall: { stall: string; status: number; json: unknown };
  }
}

const held = new WeakMap<Page, Map<string, () => void>>();

export function release(page: Page, glob: string): boolean {
  const open = held.get(page)?.get(glob);
  held.get(page)?.delete(glob);
  open?.();
  return open !== undefined;
}

export const step: StepRunner = {
  kind: "stall",
  run: async (page, step) => {
    if (!("stall" in step)) throw wrongKind("stall", step);
    const { stall, status, json } = step;
    const gate = Promise.withResolvers<void>();
    const table = held.get(page) ?? new Map<string, () => void>();
    table.set(stall, gate.resolve);
    held.set(page, table);
    await page.route(stall, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await gate.promise;
      return route.fulfill({ status, json }).catch(() => {});
    });
  },
};
