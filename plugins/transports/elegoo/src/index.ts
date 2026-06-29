import {
  StageError,
  type GcodeArtifact,
  type PrintHandle,
  type PrinterTarget,
  type PrintStatus,
  type StageCtx,
  type TransportPlugin,
} from "@conveyor/shared";

/**
 * ElegooLink / SDCP transport. Elegoo printers speak the SDCP protocol (WebSocket
 * control + HTTP file upload) on the LAN. The exact framing must be confirmed by a
 * discovery spike (SPEC open decision) — M0 ships the stub + the contract shape so
 * the rest of the pipeline is exercised against a real Station.
 */
const STUB = process.env.CONVEYOR_ENGINE_STUB === "1";

export const elegoo: TransportPlugin = {
  id: "elegoo",
  name: "ElegooLink",
  version: "0.1.0",
  stage: "transport",
  acceptsFlavors: ["klipper", "marlin"],

  async discover(): Promise<PrinterTarget[]> {
    if (STUB) return [];
    // M2: SDCP UDP broadcast discovery on the LAN.
    throw new StageError("transport", "elegoo discovery not implemented (M2)");
  },

  async submit(gcode: GcodeArtifact, target: PrinterTarget, ctx: StageCtx): Promise<PrintHandle> {
    if (STUB) {
      ctx.log(`[stub] elegoo upload ${gcode.path} → ${target.address}`);
      return { transportId: "elegoo", printerId: target.id, ref: gcode.path };
    }
    // M2: SDCP file upload + print-start command over the device WebSocket.
    throw new StageError("transport", "elegoo submit not implemented (M2) — needs SDCP spike");
  },

  async *status(handle: PrintHandle): AsyncIterable<PrintStatus> {
    if (STUB) {
      yield { state: "transferring" };
      for (let p = 0; p <= 1.0001; p += 0.25) yield { state: "printing", progress: Math.min(p, 1) };
      yield { state: "done", progress: 1 };
      return;
    }
    // M2: subscribe to SDCP status frames; map Elegoo status enum → PrintStatus.
    throw new StageError("transport", "elegoo live status not implemented (M2)");
  },
};
