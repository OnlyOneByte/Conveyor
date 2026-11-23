import { describe, expect, test } from "bun:test";
import { CompatibilityError, type JobTarget } from "@conveyor/shared";
import { z } from "zod";
import { apiRegistry } from "./registry.js";
import { describeIssues, listTransports, validateJobRequest } from "./validate.js";

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

  test("rejects a generator the registry does not know", () => {
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

describe("listTransports", () => {
  test("lists every registered transport with its accepted flavours", () => {
    expect(listTransports()).toEqual(
      [...apiRegistry.transports.values()].map((t) => ({
        id: t.id,
        name: t.name,
        acceptsFlavors: [...t.acceptsFlavors],
      })),
    );
    expect(listTransports().map((t) => t.id)).toEqual(["moonraker", "elegoo"]);
  });

  test("returns copies, so a caller cannot change the registry's flavours", () => {
    const before = [...(apiRegistry.transports.get("moonraker")?.acceptsFlavors ?? [])];
    listTransports()[0]?.acceptsFlavors.push("reprap");
    expect(apiRegistry.transports.get("moonraker")?.acceptsFlavors).toEqual(before);
  });
});

describe("describeIssues", () => {
  const issues = (schema: z.ZodType, value: unknown) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? [] : parsed.error.issues;
  };

  test("names each unknown key under its prefix", () => {
    const schema = z.strictObject({ a: z.number() });
    expect(describeIssues(issues(schema, { a: 1, b: 2, c: 3 }), ["generator", "params"])).toBe(
      "generator.params.b: unknown field; generator.params.c: unknown field",
    );
  });

  test("describes a bad record key with the inner message", () => {
    const schema = z.record(z.string().regex(/^[a-z]+$/, "lowercase only"), z.number());
    expect(describeIssues(issues(schema, { Bad: 1 }))).toBe("Bad: lowercase only");
  });

  test("names the field of an ordinary issue, and the body when there is no path", () => {
    expect(describeIssues(issues(z.object({ n: z.number() }), { n: "x" }))).toContain("n: ");
    expect(describeIssues(issues(z.number(), "x"))).toStartWith("body: ");
  });
});
