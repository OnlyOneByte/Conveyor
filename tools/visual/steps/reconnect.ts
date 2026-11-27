import { unblockEditor } from "../offline.ts";
import { type StepRunner, wrongKind } from "../step.ts";
import { lazyChunks } from "./lazy.ts";

declare module "../step.ts" {
  interface StepKinds {
    reconnect: { reconnect: string; delayMs?: number };
  }
}

export const step: StepRunner = {
  kind: "reconnect",
  run: async (page, step, _warnings, { root }) => {
    if (!("reconnect" in step)) throw wrongKind("reconnect", step);
    if (step.reconnect === "editor") return unblockEditor(page, root, step.delayMs);
    for (const file of lazyChunks(root, step.reconnect)) await page.unroute(`**/${file}`);
  },
};
