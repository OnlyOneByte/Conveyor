import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegistry } from "@conveyor/plugin-registry";
import { createRegistry, type GeneratorPlugin, type TransportPlugin } from "@conveyor/shared";
import { z } from "zod";
import { harness } from "../test/helpers/pipeline-harness";

const OUTSIDE = "All objects are outside of the print volume.";

let dir = "";
const saved = { bin: process.env.PRUSA_BIN, stub: process.env.CONVEYOR_ENGINE_STUB };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "conveyor-slice-output-"));
  delete process.env.CONVEYOR_ENGINE_STUB;
});

afterEach(async () => {
  for (const [key, value] of [
    ["PRUSA_BIN", saved.bin],
    ["CONVEYOR_ENGINE_STUB", saved.stub],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(dir, { recursive: true, force: true });
});

async function prusaThatPrints(stderr: string, writes: string | null): Promise<void> {
  const bin = join(dir, "prusa-slicer");
  const output = writes === null ? "" : `printf '%s' '${writes}' > "$out"`;
  await writeFile(
    bin,
    `#!/bin/sh\nwhile [ "$1" != "--output" ]; do shift; done\nout="$2"\n${output}\nprintf '%s\\n' '${stderr}' >&2\nexit 0\n`,
  );
  await chmod(bin, 0o755);
  process.env.PRUSA_BIN = bin;
}

function prusaHarness() {
  let submits = 0;
  const generator: GeneratorPlugin = {
    id: "gen",
    name: "fake generator",
    version: "0.0.0",
    stage: "generator",
    params: z.unknown(),
    paramSchema: {},
    outputs: ["stl"],
    generate: async () => ({ path: join(dir, "model.stl"), format: "stl" }),
  };
  const transport: TransportPlugin = {
    id: "tr",
    name: "fake transport",
    version: "0.0.0",
    stage: "transport",
    acceptsFlavors: ["klipper"],
    submit: async () => {
      submits++;
      return { transportId: "tr", printerId: "p1", ref: "model.gcode" };
    },
    status: async function* () {
      yield { state: "done" };
    },
  };
  const prusa = buildRegistry().slicers.get("prusa");
  if (!prusa) throw new Error("prusa is not registered");
  const registry = createRegistry();
  registry.generators.set(generator.id, generator);
  registry.slicers.set("sl", prusa);
  registry.transports.set(transport.id, transport);
  const h = harness({
    workDir: dir,
    deps: () => ({
      registry,
      resolveProfile: async () => ({
        profile: { id: "prusa/klipper-pla-0.2", name: "prof", path: dir },
        source: "bundled",
        cleanup: async () => {},
      }),
    }),
  });
  return { h, submits: () => submits };
}

describe("a slicer that exits 0 without writing G-code", () => {
  beforeEach(async () => {
    await writeFile(join(dir, "config.ini"), "layer_height = 0.2\n");
  });

  test("fails the slice stage with the slicer's stderr, and never reaches the printer", async () => {
    await prusaThatPrints(OUTSIDE, null);
    const { h, submits } = prusaHarness();
    await expect(h.run()).rejects.toMatchObject({ stage: "slicer" });
    expect(h.records[0]?.state).toBe("failed");
    expect(h.records[0]?.reason).toBe(
      `${process.env.PRUSA_BIN} exited 0 but wrote no G-code: ${OUTSIDE}`,
    );
    expect(h.events.map((event) => event.state)).not.toContain("transferring");
    expect(submits()).toBe(0);
  });

  test("an empty G-code file fails the slice stage the same way", async () => {
    await prusaThatPrints(OUTSIDE, "");
    const { h, submits } = prusaHarness();
    await expect(h.run()).rejects.toMatchObject({ stage: "slicer" });
    expect(h.records[0]?.state).toBe("failed");
    expect(h.records[0]?.reason).toBe(
      `${process.env.PRUSA_BIN} exited 0 but wrote no G-code (the file is empty): ${OUTSIDE}`,
    );
    expect(submits()).toBe(0);
  });

  test("a slicer that writes G-code goes on to the printer", async () => {
    await prusaThatPrints("", "G28\\n");
    const { h, submits } = prusaHarness();
    expect(await h.run()).toBe("done");
    expect(submits()).toBe(1);
  });
});
