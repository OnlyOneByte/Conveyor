import type { Page } from "playwright";
import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    stall: { stall: string; status: number; json: unknown };
  }
}

interface Gate {
  open: (fail: boolean) => void;
  held: number;
}

const gates = new WeakMap<Page, Map<string, Gate>>();

export function release(page: Page, glob: string, fail = false): number | null {
  const gate = gates.get(page)?.get(glob);
  if (!gate) return null;
  gates.get(page)?.delete(glob);
  gate.open(fail);
  return gate.held;
}

export function hold(page: Page, name: string): () => Promise<boolean> {
  const wait = Promise.withResolvers<boolean>();
  const gate: Gate = { open: wait.resolve, held: 0 };
  const table = gates.get(page) ?? new Map<string, Gate>();
  table.set(name, gate);
  gates.set(page, table);
  return () => {
    gate.held += 1;
    return wait.promise;
  };
}

export const step: StepRunner = {
  kind: "stall",
  run: async (page, step) => {
    if (!("stall" in step)) throw wrongKind("stall", step);
    const { stall, status, json } = step;
    const held = hold(page, stall);
    await page.route(stall, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      if (await held()) return route.abort("internetdisconnected");
      return route.fulfill({ status, json }).catch((err: unknown) => {
        if (!page.isClosed()) throw err;
      });
    });
  },
};
