import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PrintStatus } from "@conveyor/shared";
import { moonraker as plugin } from "./index.ts";

const cleanups: (() => void)[] = [];
beforeEach(() => {
  withEnv("MOONRAKER_POLL_MS", "1");
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function withEnv(name: string, value: string): void {
  const previous = process.env[name];
  process.env[name] = value;
  cleanups.push(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

function printer(replies: (string | number)[]) {
  let polls = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      polls++;
      const reply = replies.length > 1 ? replies.shift() : replies[0];
      if (typeof reply === "number") return new Response("busy", { status: reply });
      return Response.json({ result: { status: { print_stats: { state: reply } } } });
    },
  });
  cleanups.push(() => server.stop(true));
  const handle = {
    transportId: "moonraker",
    printerId: "p1",
    ref: "a.gcode",
    address: `127.0.0.1:${server.port}`,
  };
  return { handle, polls: () => polls };
}

async function states(statuses: AsyncIterable<PrintStatus>): Promise<string[]> {
  const out: string[] = [];
  for await (const s of statuses) out.push(s.state);
  return out;
}

describe("moonraker status poll failures", () => {
  test("a few failed polls in a row don't end a print that is still running", async () => {
    const { handle } = printer(["printing", 503, 502, 503, "printing", "complete"]);
    expect(await states(plugin.status(handle))).toEqual([
      "transferring",
      "printing",
      "printing",
      "done",
    ]);
  });

  test("the job fails once MOONRAKER_STATUS_FAILURES polls in a row fail", async () => {
    withEnv("MOONRAKER_STATUS_FAILURES", "3");
    const { handle, polls } = printer(["printing", 503]);
    await expect(states(plugin.status(handle))).rejects.toThrow(
      "moonraker status query failed: 503 (3 in a row)",
    );
    expect(polls()).toBe(4);
  });

  test("a success resets the count", async () => {
    withEnv("MOONRAKER_STATUS_FAILURES", "2");
    const { handle } = printer([503, "printing", 503, "printing", 503, "complete"]);
    expect(await states(plugin.status(handle))).toEqual([
      "transferring",
      "printing",
      "printing",
      "done",
    ]);
  });

  test.each([
    ["MOONRAKER_STATUS_TIMEOUT_MS", "-5"],
    ["MOONRAKER_STATUS_TIMEOUT_MS", "soon"],
    ["MOONRAKER_STATUS_FAILURES", "0"],
    ["MOONRAKER_POLL_MS", "fast"],
  ])("%s=%s fails the stage with a message naming the setting", async (name, value) => {
    withEnv(name, value);
    const { handle, polls } = printer(["printing"]);
    await expect(states(plugin.status(handle))).rejects.toThrow(
      `${name} must be a whole number above 0, got ${value}`,
    );
    expect(polls()).toBe(0);
  });
});

describe("moonraker refuses metadata addresses", () => {
  const metadata = {
    transportId: "moonraker",
    printerId: "p1",
    ref: "a.gcode",
    address: "metadata.google.internal",
  };

  test("status and cancel refuse before sending anything, naming the override", async () => {
    await expect(states(plugin.status(metadata))).rejects.toThrow(
      "Conveyor won't connect to metadata.google.internal",
    );
    await expect(plugin.cancel?.(metadata) ?? Promise.resolve()).rejects.toThrow(
      "add metadata.google.internal to PRINTER_ADDRESS_ALLOW",
    );
  });
});
