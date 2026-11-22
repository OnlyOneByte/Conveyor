import { describe, expect, test } from "bun:test";
import { CompatibilityError, type JobTarget, type StageCtx } from "@conveyor/shared";
import { apiRegistry } from "./registry-view.js";
import { listTransports, validateJobRequest, validatePrinterTransport } from "./validate.js";

const target: JobTarget = {
  printerId: "klipper-garage",
  transportId: "moonraker",
  profileId: "orca/klipper-pla-0.2",
  profileName: "Klipper PLA 0.2mm (Orca)",
  profilePath: "/profiles/orca-klipper-pla-0.2",
  slicerId: "orca",
  gcodeFlavor: "klipper",
};

const request = (generatorId: string) => ({
  generator: { id: generatorId, params: {} },
  printerId: target.printerId,
  profileId: target.profileId,
});

describe("validateJobRequest", () => {
  test("accepts a registered generator, slicer and transport that fit together", () => {
    expect(() => validateJobRequest(request("gridfinity"), target)).not.toThrow();
  });

  test("rejects a generator the api registry does not know", () => {
    expect(() => validateJobRequest(request("openscad"), target)).toThrow(
      new CompatibilityError("unknown generator: openscad"),
    );
  });

  test("rejects a generator the printer's allowlist excludes", () => {
    expect(() =>
      validateJobRequest(request("gridfinity"), { ...target, allowedGenerators: ["passthrough"] }),
    ).toThrow("does not allow generator gridfinity");
  });

  test("rejects a flavour the transport cannot print", () => {
    expect(() =>
      validateJobRequest(request("gridfinity"), { ...target, gcodeFlavor: "reprap" }),
    ).toThrow("emits reprap");
  });
});

describe("validatePrinterTransport", () => {
  test.each(["moonraker", "elegoo"])("accepts the registered transport %p", (id) => {
    expect(() => validatePrinterTransport(id)).not.toThrow();
  });

  test("rejects an unknown transport id with a CompatibilityError", () => {
    expect(() => validatePrinterTransport("moonraker2")).toThrow(
      new CompatibilityError("unknown transport: moonraker2"),
    );
  });
});

describe("listTransports", () => {
  test("lists every registered transport with its accepted flavours", () => {
    expect(listTransports()).toEqual([
      { id: "moonraker", name: "Klipper / Moonraker", acceptsFlavors: ["klipper", "marlin"] },
      { id: "elegoo", name: "ElegooLink", acceptsFlavors: ["klipper", "marlin"] },
    ]);
  });

  test("returns copies, so a caller cannot change the registry's flavours", () => {
    listTransports()[0]?.acceptsFlavors.push("reprap");
    expect(apiRegistry.transports.get("moonraker")?.acceptsFlavors).toEqual(["klipper", "marlin"]);
  });
});

describe("apiRegistry", () => {
  const gcode = { path: "/data/j/model.gcode", format: "gcode" };
  const ctx: StageCtx = {
    jobId: "j",
    workDir: "/data/j",
    signal: new AbortController().signal,
    report: () => {},
    log: () => {},
  };

  test.each(["orca", "prusa"])("the %p slicer view refuses to slice in the api", (id) => {
    const slicer = apiRegistry.slicers.get(id);
    expect(slicer?.id).toBe(id);
    const profile = { id: "p", name: "p", path: "/profiles/p" };
    expect(() => slicer?.slice({ path: "/data/j/m.stl", format: "stl" }, profile, ctx)).toThrow(
      "slicing runs in the worker",
    );
  });

  test("a transport view refuses to submit or report status in the api", () => {
    const transport = apiRegistry.transports.get("elegoo");
    const printer = { id: "elegoo-1", transportId: "elegoo", address: "127.0.0.1" };
    const handle = { transportId: "elegoo", printerId: "elegoo-1", ref: "r" };
    expect(() => transport?.submit(gcode, printer, ctx)).toThrow("transport runs in the worker");
    expect(() => transport?.status(handle)).toThrow("capability-only view");
  });
});
