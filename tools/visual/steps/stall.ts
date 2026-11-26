import type { Page } from "playwright";
import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    stall: { stall: string; status: number; json: unknown };
  }
}

interface Gate {
  open: () => void;
  held: number;
}

const gates = new WeakMap<Page, Map<string, Gate>>();

export function release(page: Page, glob: string): number | null {
  const gate = gates.get(page)?.get(glob);
  if (!gate) return null;
  gates.get(page)?.delete(glob);
  gate.open();
  return gate.held;
}

export const step: StepRunner = {
  kind: "stall",
  run: async (page, step) => {
    if (!("stall" in step)) throw wrongKind("stall", step);
    const { stall, status, json } = step;
    const wait = Promise.withResolvers<void>();
    const gate: Gate = { open: wait.resolve, held: 0 };
    const table = gates.get(page) ?? new Map<string, Gate>();
    table.set(stall, gate);
    gates.set(page, table);
    await page.route(stall, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      gate.held += 1;
      await wait.promise;
      return route.fulfill({ status, json }).catch(() => {});
    });
  },
};
