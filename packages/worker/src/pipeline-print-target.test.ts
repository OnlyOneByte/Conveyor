import { expect, test } from "bun:test";
import type { PrinterTarget } from "@conveyor/shared";
import { harness, waitForAbort } from "../test/helpers/pipeline-harness";

test("status and cancel get the job's printer, secrets included, so they can authenticate", async () => {
  const seen: (PrinterTarget | undefined)[] = [];
  const h = harness({
    status: async function* (_handle, signal, target) {
      seen.push(target);
      yield { state: "printing", progress: 0.1 };
      h.controller.abort();
      if (signal) await waitForAbort(signal);
    },
    cancel: async (_handle, target) => {
      seen.push(target);
    },
  });
  expect(await h.run()).toBe("canceled");
  expect(seen).toHaveLength(2);
  for (const target of seen) expect(target?.secrets).toEqual({ mainboardId: "mainboard-abc" });
});
