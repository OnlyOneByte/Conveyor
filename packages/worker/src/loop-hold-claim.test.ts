import { afterEach, expect, test } from "bun:test";
import { holdPrinter, releasePrinterHold } from "@conveyor/shared/queue";
import { cleanup, db, enqueue, row, setup, start, uid, until } from "../test/helpers/loop-harness";

afterEach(cleanup);

test("a hold placed after the API's 409 check keeps the job queued, unmodelled, until Release hold", async () => {
  setup();
  enqueue("held", "p1");
  holdPrinter(db, { printerId: "p1", jobId: "earlier", reason: "may have started", at: 1 });
  enqueue("free", "p2");
  const generated: string[] = [];
  start({
    generate: async (ctx) => {
      generated.push(ctx.jobId);
    },
  });
  await until(() => row("free").state === "done");
  expect(row("held")).toMatchObject({ state: "queued", attempts: 0, lease_owner: null });
  expect(generated).toEqual([uid("free")]);

  releasePrinterHold(db, "p1");
  await until(() => row("held").state === "done");
  expect(generated).toEqual([uid("free"), uid("held")]);
});
