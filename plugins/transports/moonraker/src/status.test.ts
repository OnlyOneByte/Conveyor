import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { PrintStatus } from "@conveyor/shared";
import { moonraker as plugin } from "./index.ts";

const cleanups: (() => void)[] = [];
const realSetTimeout = globalThis.setTimeout;
beforeEach(() => {
  const fast = spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) =>
    realSetTimeout(fn, Math.min(ms ?? 0, 1))) as typeof setTimeout);
  cleanups.push(() => fast.mockRestore());
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

type Reply = Record<string, unknown> | number;

function printer(replies: Reply[]) {
  const keys: (string | null)[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      keys.push(req.headers.get("x-api-key"));
      const reply = replies.length > 1 ? replies.shift() : replies[0];
      if (typeof reply === "number") return new Response("busy", { status: reply });
      return Response.json({ result: { status: reply } });
    },
  });
  cleanups.push(() => server.stop(true));
  return {
    keys,
    handle: {
      transportId: "moonraker",
      printerId: "p1",
      ref: "a.gcode",
      address: `127.0.0.1:${server.port}`,
    },
  };
}

async function collect(statuses: AsyncIterable<PrintStatus>): Promise<PrintStatus[]> {
  const out: PrintStatus[] = [];
  for await (const s of statuses) out.push(s);
  return out;
}

const stats = (state: string, extra: Record<string, unknown> = {}) => ({
  print_stats: { state, ...extra },
});

describe("moonraker status", () => {
  test("follows printing and paused to complete, preferring the display progress, clamped", async () => {
    const previousKey = process.env.MOONRAKER_API_KEY;
    process.env.MOONRAKER_API_KEY = "k1";
    cleanups.push(() => {
      if (previousKey === undefined) delete process.env.MOONRAKER_API_KEY;
      else process.env.MOONRAKER_API_KEY = previousKey;
    });
    const { keys, handle } = printer([
      {
        ...stats("printing", { message: "layer 3" }),
        display_status: { progress: 0.25 },
        virtual_sdcard: { progress: 0.6 },
      },
      { ...stats("paused"), virtual_sdcard: { progress: 1.7 } },
      stats("complete"),
    ]);
    expect(await collect(plugin.status(handle))).toEqual([
      { state: "transferring" },
      { state: "printing", progress: 0.25, message: "layer 3" },
      { state: "printing", progress: 1, message: "paused" },
      { state: "done", progress: 1 },
    ]);
    expect(keys).toEqual(["k1", "k1", "k1"]);
  });

  test("ends canceled, or failed with the printer's message or a default", async () => {
    expect((await collect(plugin.status(printer([stats("cancelled")]).handle))).at(-1)).toEqual({
      state: "canceled",
      message: "print cancelled on printer",
    });
    const nozzle = printer([stats("error", { message: "nozzle temp" })]).handle;
    expect((await collect(plugin.status(nozzle))).at(-1)).toEqual({
      state: "failed",
      message: "nozzle temp",
    });
    expect((await collect(plugin.status(printer([stats("error")]).handle))).at(-1)).toEqual({
      state: "failed",
      message: "printer reported an error",
    });
  });

  test("waits through standby and unknown states, and reads standby after a full print as done", async () => {
    const { handle } = printer([
      stats("standby"),
      stats("startup"),
      { ...stats("printing"), virtual_sdcard: { progress: 0.5 } },
      { ...stats("standby"), virtual_sdcard: { progress: 1 } },
    ]);
    expect((await collect(plugin.status(handle))).map((s) => s.state)).toEqual([
      "transferring",
      "printing",
      "done",
    ]);
  });

  test("fails on a query error, a missing address, or an abort while waiting", async () => {
    await expect(collect(plugin.status(printer([503]).handle))).rejects.toThrow(
      "moonraker status query failed: 503",
    );
    await expect(
      collect(plugin.status({ ...printer([503]).handle, address: undefined })),
    ).rejects.toThrow("missing printer address");
    const controller = new AbortController();
    const { handle } = printer([stats("printing")]);
    const statuses = plugin.status(handle, controller.signal)[Symbol.asyncIterator]();
    await statuses.next();
    await statuses.next();
    setTimeout(() => controller.abort(), 20);
    await expect(statuses.next()).rejects.toThrow("moonraker status aborted");
  });
});
