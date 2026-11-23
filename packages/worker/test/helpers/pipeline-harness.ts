import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRegistry,
  type GeneratorPlugin,
  type JobRequest,
  type JobState,
  type PrinterTarget,
  type PrintHandle,
  type PrintStatus,
  type SlicerPlugin,
  type StageCtx,
  type TransportPlugin,
} from "@conveyor/shared";
import { z } from "zod";
import { type PipelineDeps, resumeJob, runJob, type TerminalState } from "../../src/pipeline";

export const req: JobRequest = { generator: { id: "gen" }, printerId: "p1", profileId: "prof" };

export function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new Error("aborted"));
    else signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}

export function never(): Promise<never> {
  return new Promise(() => {});
}

export interface HarnessOptions {
  generate?: (ctx: StageCtx) => Promise<void>;
  slice?: (ctx: StageCtx) => Promise<void>;
  submit?: (ctx: StageCtx) => Promise<void>;
  status?: (handle: PrintHandle, signal?: AbortSignal) => AsyncIterable<PrintStatus>;
  cancel?: ((handle: PrintHandle) => Promise<void>) | null;
  handleFor?: (target: PrinterTarget, ref: string) => PrintHandle;
  cancelRequested?: () => Promise<boolean>;
  record?: () => void;
  profileCleanup?: () => Promise<void>;
  cancelPollMs?: number;
  streamCloseMs?: number;
  workDir?: string;
  deps?: (h: Harness) => Partial<PipelineDeps>;
  resume?: boolean;
}

export interface Harness {
  controller: AbortController;
  events: { state: JobState; message?: string; reason?: string }[];
  records: { state: TerminalState; reason?: string; notes?: string }[];
  cancels: PrintHandle[];
  order: string[];
  submits: number;
  generated: number;
  run(): Promise<TerminalState>;
}

async function* doneOnly(): AsyncIterable<PrintStatus> {
  yield { state: "done" };
}

function buildTransport(h: Harness, opts: HarnessOptions): TransportPlugin {
  const transport: TransportPlugin = {
    id: "tr",
    name: "fake transport",
    version: "0.0.0",
    stage: "transport",
    acceptsFlavors: ["klipper"],
    submit: async (_gcode, _target, ctx) => {
      h.submits++;
      await opts.submit?.(ctx);
      h.order.push("started");
      return { transportId: "tr", printerId: "p1", ref: "model.gcode", address: "10.0.0.9" };
    },
    status: opts.status ?? doneOnly,
    handleFor: opts.handleFor,
  };
  if (opts.cancel !== null) {
    const custom = opts.cancel;
    transport.cancel = async (handle) => {
      h.order.push("stopped");
      if (custom) await custom(handle);
      h.cancels.push(handle);
    };
  }
  return transport;
}

export function buildDeps(h: Harness, opts: HarnessOptions): PipelineDeps {
  const generator: GeneratorPlugin = {
    id: "gen",
    name: "fake generator",
    version: "0.0.0",
    stage: "generator",
    params: z.unknown(),
    paramSchema: {},
    outputs: ["stl"],
    generate: async (_params, ctx) => {
      h.generated++;
      await opts.generate?.(ctx);
      return { path: "/tmp/model.stl", format: "stl" };
    },
  };
  const slicer: SlicerPlugin = {
    id: "sl",
    name: "fake slicer",
    version: "0.0.0",
    stage: "slicer",
    accepts: ["stl"],
    gcodeFlavor: "klipper",
    slice: async (_model, _profile, ctx) => {
      await opts.slice?.(ctx);
      return { path: "/tmp/model.gcode", format: "gcode" };
    },
  };
  const registry = createRegistry();
  registry.generators.set(generator.id, generator);
  registry.slicers.set(slicer.id, slicer);
  registry.transports.set("tr", buildTransport(h, opts));
  return {
    registry,
    publish: async (_id, state, extra) => {
      h.events.push({ state, message: extra?.message, reason: extra?.error?.reason });
    },
    record: (_id, _req, extra) => {
      opts.record?.();
      h.records.push({ state: extra.state, reason: extra.reason, notes: extra.notes });
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
      secrets: { mainboardId: "mainboard-abc" },
    }),
    resolveProfile: async () => ({
      profile: { id: "prof", name: "prof", path: "/profiles/prof" },
      source: "bundled",
      cleanup: opts.profileCleanup ?? (async () => {}),
    }),
    cancelRequested: opts.cancelRequested ?? (async () => false),
    log: () => {},
  };
}

export function harness(opts: HarnessOptions = {}): Harness {
  const h: Harness = {
    controller: new AbortController(),
    events: [],
    records: [],
    cancels: [],
    order: [],
    submits: 0,
    generated: 0,
    run: async () => {
      const workDir = opts.workDir ?? (await mkdtemp(join(tmpdir(), "conveyor-pipeline-")));
      return (opts.resume ? resumeJob : runJob)(
        {
          jobId: "job-1",
          req,
          workDir,
          controller: h.controller,
          cancelPollMs: opts.cancelPollMs,
          streamCloseMs: opts.streamCloseMs,
          historyRetryMs: 0,
        },
        deps,
      );
    },
  };
  const deps = { ...buildDeps(h, opts), ...opts.deps?.(h) };
  return h;
}

export const states = (h: Harness): JobState[] => h.events.map((e) => e.state);
