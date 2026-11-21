import type { GcodeArtifact } from "../../src/artifacts.ts";
import type {
  PrinterTarget,
  PrintHandle,
  PrintStatus,
  TransportPlugin,
} from "../../src/plugins.ts";

export interface Submission {
  gcode: GcodeArtifact;
  target: PrinterTarget;
  handle: PrintHandle;
}

export interface FakeTransportOptions {
  id?: string;
  acceptsFlavors?: string[];
  statuses?: PrintStatus[];
  submitError?: Error;
}

export interface FakeTransport {
  plugin: TransportPlugin;
  submissions: Submission[];
  canceled: PrintHandle[];
}

const DEFAULT_STATUSES: PrintStatus[] = [
  { state: "transferring", progress: 0 },
  { state: "printing", progress: 0.5 },
  { state: "done", progress: 1 },
];

export function fakeTransport(options: FakeTransportOptions = {}): FakeTransport {
  const id = options.id ?? "fake";
  const statuses = options.statuses ?? DEFAULT_STATUSES;
  const submissions: Submission[] = [];
  const canceled: PrintHandle[] = [];
  const plugin: TransportPlugin = {
    id,
    name: "Fake printer",
    version: "0.0.0",
    stage: "transport",
    acceptsFlavors: options.acceptsFlavors ?? ["klipper", "marlin"],
    submit: async (gcode, target) => {
      if (options.submitError) throw options.submitError;
      const handle: PrintHandle = {
        transportId: id,
        printerId: target.id,
        ref: `fake-${submissions.length + 1}`,
        address: target.address,
      };
      submissions.push({ gcode, target, handle });
      return handle;
    },
    status: async function* () {
      yield* statuses;
    },
    cancel: async (handle) => {
      canceled.push(handle);
    },
  };
  return { plugin, submissions, canceled };
}
