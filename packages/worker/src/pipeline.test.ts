import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRegistry,
  type GeneratorPlugin,
  type JobRequest,
  type JobState,
  type PrintHandle,
  type PrintStatus,
  type SlicerPlugin,
  type StageCtx,
  type TransportPlugin,
} from "@conveyor/shared";
import { type PipelineDeps, runJob, type TerminalState } from "./pipeline";

const req: JobRequest = { generator: { id: "gen" }, printerId: "p1", profileId: "prof" };

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}

interface Harness {
  controller: AbortController;
  events: { state: JobState; message?: string; reason?: string }[];
  records: { state: TerminalState; reason?: string }[];
  cancels: PrintHandle[];
  submits: number;
  generated: number;
  run(): Promise<TerminalState>;
}

function harness(opts: {
  generate?: (ctx: StageCtx) => Promise<unknown>;
  slice?: (ctx: StageCtx) => Promise<unknown>;
  status?: (handle: PrintHandle, signal?: AbortSignal) => AsyncIterable<PrintStatus>;
  cancel?: ((handle: PrintHandle) => Promise<void>) | null;
  cancelRequested?: () => Promise<boolean>;
  submit?: () => Promise<void>;
}): Harness {
  const h: Harness = {
    controller: new AbortController(),
    events: [],
    records: [],
    cancels: [],
    submits: 0,
    generated: 0,
    run: async () => {
      const workDir = await mkdtemp(join(tmpdir(), "conveyor-pipeline-"));
      return runJob("job-1", req, workDir, h.controller, deps);
    },
  };
  const registry = createRegistry();
  registry.generators.set("gen", {
    id: "gen",
    generate: async (_params: unknown, ctx: StageCtx) => {
      h.generated++;
      await opts.generate?.(ctx);
      return { path: "/tmp/model.stl", format: "stl" };
    },
  } as unknown as GeneratorPlugin);
  registry.slicers.set("sl", {
    id: "sl",
    slice: async (_m: unknown, _p: unknown, ctx: StageCtx) => {
      await opts.slice?.(ctx);
      return { path: "/tmp/model.gcode", flavor: "klipper" };
    },
  } as unknown as SlicerPlugin);
  const transport = {
    id: "tr",
    submit: async () => {
      h.submits++;
      await opts.submit?.();
      return { transportId: "tr", printerId: "p1", ref: "model.gcode", address: "10.0.0.9" };
    },
    status:
      opts.status ??
      async function* () {
        yield { state: "done" } as PrintStatus;
      },
  } as unknown as TransportPlugin;
  if (opts.cancel !== null) {
    transport.cancel =
      opts.cancel ??
      (async (handle: PrintHandle) => {
        h.cancels.push(handle);
      });
  }
  registry.transports.set("tr", transport);

  const deps: PipelineDeps = {
    registry,
    publish: async (_id, state, extra) => {
      h.events.push({ state, message: extra?.message, reason: extra?.error?.reason });
    },
    record: (_id, _req, state, extra) => {
      h.records.push({ state, reason: extra.reason });
    },
    resolveJobTarget: () => ({
      printerId: "p1",
      transportId: "tr",
      profileId: "prof",
      profileName: "prof",
      profilePath: "/profiles/prof",
      slicerId: "sl",
      gcodeFlavor: "klipper",
    }),
    resolvePrinter: async () => ({
      id: "p1",
      transportId: "tr",
      address: "10.0.0.9",
      secrets: {},
    }),
    resolveProfile: async () => ({
      profile: { id: "prof", name: "prof", path: "/profiles/prof" },
      source: "bundled",
      cleanup: async () => {},
    }),
    cancelRequested: opts.cancelRequested ?? (async () => false),
    log: () => {},
  };
  return h;
}

const states = (h: Harness) => h.events.map((e) => e.state);

describe("runJob cancel", () => {
  test("cancel while printing stops the printer and settles as canceled", async () => {
    const h = harness({
      status: async function* (_handle, signal) {
        yield { state: "printing", progress: 0.1 };
        h.controller.abort();
        if (signal) await waitForAbort(signal);
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(h.cancels).toHaveLength(1);
    expect(h.cancels[0].address).toBe("10.0.0.9");
    expect(states(h)).toEqual(["generating", "slicing", "transferring", "printing", "canceled"]);
    expect(h.records).toEqual([{ state: "canceled", reason: undefined }]);
  });

  test("a status stream that ignores the signal still stops the printer", async () => {
    const h = harness({
      status: async function* () {
        yield { state: "printing", progress: 0.2 };
        setTimeout(() => h.controller.abort(), 5);
        await new Promise(() => {});
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(h.cancels).toHaveLength(1);
    expect(h.records[0].state).toBe("canceled");
  });

  test("cancel during slicing aborts the slice and never reaches the printer", async () => {
    let sliceSignal: AbortSignal | undefined;
    const h = harness({
      slice: (ctx) => {
        sliceSignal = ctx.signal;
        setTimeout(() => h.controller.abort(), 5);
        return waitForAbort(ctx.signal);
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(sliceSignal?.aborted).toBe(true);
    expect(h.submits).toBe(0);
    expect(h.cancels).toHaveLength(0);
    expect(states(h)).toEqual(["generating", "slicing", "canceled"]);
  });

  test("cancel during submit waits for the start, then stops that print", async () => {
    const order: string[] = [];
    const h = harness({
      submit: async () => {
        h.controller.abort();
        await new Promise((r) => setTimeout(r, 5));
        order.push("started");
      },
      cancel: async (handle) => {
        order.push("stopped");
        h.cancels.push(handle);
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(order).toEqual(["started", "stopped"]);
    expect(h.cancels[0].ref).toBe("model.gcode");
  });

  test("a durable cancel flag set before start skips every stage", async () => {
    const h = harness({ cancelRequested: async () => true });
    expect(await h.run()).toBe("canceled");
    expect(h.generated).toBe(0);
    expect(states(h)).toEqual(["canceled"]);
    expect(h.records[0].state).toBe("canceled");
  });

  test("a durable cancel flag seen between stages stops the job", async () => {
    let flag = false;
    const h = harness({
      generate: async () => {
        flag = true;
      },
      cancelRequested: async () => flag,
    });
    expect(await h.run()).toBe("canceled");
    expect(states(h)).toEqual(["generating", "canceled"]);
  });

  test("a print canceled on the printer is recorded as canceled", async () => {
    const h = harness({
      status: async function* () {
        yield { state: "printing", progress: 0.5 };
        yield { state: "canceled", message: "print cancelled on printer" };
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(h.cancels).toHaveLength(0);
    expect(h.records[0].state).toBe("canceled");
  });

  test("a printer that rejects the stop is reported as failed, not canceled", async () => {
    const h = harness({
      status: async function* (_handle, signal) {
        yield { state: "printing", progress: 0.1 };
        h.controller.abort();
        if (signal) await waitForAbort(signal);
      },
      cancel: async () => {
        throw new Error("moonraker cancel failed: 503");
      },
    });
    await expect(h.run()).rejects.toThrow("did not confirm the stop");
    expect(states(h).at(-1)).toBe("failed");
    expect(h.records[0].state).toBe("failed");
    expect(h.records[0].reason).toContain("moonraker cancel failed: 503");
  });

  test("a real failure is still recorded as failed", async () => {
    const h = harness({
      status: async function* () {
        yield { state: "failed", message: "thermal runaway" };
      },
    });
    await expect(h.run()).rejects.toThrow("thermal runaway");
    expect(h.records[0]).toEqual({ state: "failed", reason: "thermal runaway" });
  });

  test("an uncanceled job completes as done", async () => {
    const h = harness({});
    expect(await h.run()).toBe("done");
    expect(states(h).at(-1)).toBe("done");
  });
});
