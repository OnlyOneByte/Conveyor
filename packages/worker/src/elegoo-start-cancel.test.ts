import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegistry } from "@conveyor/plugin-registry";
import { createRegistry, type GeneratorPlugin, type SlicerPlugin } from "@conveyor/shared";
import { z } from "zod";
import { harness } from "../test/helpers/pipeline-harness";

const START_PRINT = 128;
const STOP_PRINT = 130;
const IDLE = JSON.stringify({
  Topic: "sdcp/status/mainboard-abc",
  Data: { Status: { CurrentStatus: [0], PrintInfo: { Status: 0, TaskId: "before" } } },
});

class NeverAcksStart {
  static sent: number[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    queueMicrotask(() => this.onopen?.());
  }
  send(raw: string) {
    const frame = JSON.parse(raw);
    const cmd: number = frame.Data.Cmd;
    NeverAcksStart.sent.push(cmd);
    if (cmd === 0) return queueMicrotask(() => this.onmessage?.({ data: IDLE }));
    if (cmd === START_PRINT) return;
    const ack = JSON.stringify({ Data: { RequestID: frame.Data.RequestID, Data: { Ack: 0 } } });
    queueMicrotask(() => this.onmessage?.({ data: ack }));
  }
  close() {}
}

const RealWebSocket = globalThis.WebSocket;
const { preconnect } = globalThis.fetch;
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  Reflect.set(globalThis, "WebSocket", RealWebSocket);
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function until(check: () => boolean, what: string, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`${what} within ${ms} ms`);
    await Bun.sleep(5);
  }
}

test("a cancel during the START_PRINT ack wait ends the job canceled at once and sends STOP_PRINT", async () => {
  const dir = await mkdtemp(join(tmpdir(), "conveyor-elegoo-cancel-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const gcode = join(dir, "model.gcode");
  await writeFile(gcode, "G28\n");
  const upload = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(async () => new Response("{}", { status: 200 }), { preconnect }),
  );
  cleanups.push(() => upload.mockRestore());
  NeverAcksStart.sent = [];
  Reflect.set(globalThis, "WebSocket", NeverAcksStart);

  const elegoo = buildRegistry().transports.get("elegoo");
  if (!elegoo) throw new Error("no elegoo transport");
  const generator: GeneratorPlugin = {
    id: "gen",
    name: "gen",
    version: "0",
    stage: "generator",
    params: z.unknown(),
    paramSchema: {},
    outputs: ["stl"],
    generate: async () => ({ path: join(dir, "model.stl"), format: "stl" }),
  };
  const slicer: SlicerPlugin = {
    id: "sl",
    name: "sl",
    version: "0",
    stage: "slicer",
    accepts: ["stl"],
    gcodeFlavor: "klipper",
    slice: async () => ({ path: gcode, format: "gcode" }),
  };
  const registry = createRegistry();
  registry.generators.set(generator.id, generator);
  registry.slicers.set(slicer.id, slicer);
  registry.transports.set("tr", elegoo);
  const job = harness({ deps: () => ({ registry }), workDir: dir });

  const run = job.run();
  await until(() => NeverAcksStart.sent.includes(START_PRINT), "START_PRINT was never sent");
  await Bun.sleep(100);
  const canceledAt = Date.now();
  job.controller.abort();
  const outcome = await Promise.race([run, Bun.sleep(5000).then(() => "still waiting")]);
  const took = Date.now() - canceledAt;

  expect(outcome).toBe("canceled");
  expect(took).toBeLessThan(1000);
  expect(job.records.at(-1)?.state).toBe("canceled");
  expect(NeverAcksStart.sent.slice(NeverAcksStart.sent.indexOf(START_PRINT))).toEqual([
    START_PRINT,
    STOP_PRINT,
  ]);
});
