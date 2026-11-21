import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StageError } from "@conveyor/shared";
import {
  engineArgs,
  fakeEngine,
  setEnv,
  type TestCtx,
  testCtx,
} from "../../../../packages/shared/test/helpers/index.ts";

let n = 0;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function load(env: Record<string, string | undefined>) {
  cleanups.push(setEnv(env));
  const mod: typeof import("./index.ts") = await import(`./index.ts?case=${++n}`);
  return mod.gridfinity;
}

function setup(): { ctx: TestCtx; bin: string } {
  const ctx = testCtx();
  const bin = mkdtempSync(join(tmpdir(), "conveyor-openscad-"));
  cleanups.push(ctx.cleanup, () => rmSync(bin, { recursive: true, force: true }));
  return { ctx, bin };
}

const params = {
  gridX: 2,
  gridY: 3,
  heightUnits: 6,
  divisionsX: 1,
  divisionsY: 2,
  scoop: true,
  labelTab: false,
  magnetHoles: true,
  stackingLip: false,
};

describe("the gridfinity generator", () => {
  test("refuses params that do not parse", async () => {
    const { ctx } = setup();
    const plugin = await load({ CONVEYOR_ENGINE_STUB: "1" });
    const invalid = { ...params, gridX: "two" } as unknown as typeof params;
    const err = await plugin.generate(invalid, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StageError);
    expect((err as StageError).stage).toBe("generator");
  });

  test("writes a stub STL when the engine stub is on", async () => {
    const { ctx } = setup();
    const plugin = await load({ CONVEYOR_ENGINE_STUB: "1" });
    const model = await plugin.generate(params, ctx);
    expect(model).toMatchObject({ format: "stl", meta: { stub: true } });
    expect(readFileSync(model.path, "utf8")).toContain("solid conveyor-stub");
  });

  test("runs OpenSCAD with the params as defines and the scad file last", async () => {
    const { ctx, bin } = setup();
    const openscad = fakeEngine(bin, "openscad", 'touch "$2"');
    const plugin = await load({
      CONVEYOR_ENGINE_STUB: undefined,
      OPENSCAD_BIN: openscad,
      GRIDFINITY_SCAD: "/scad/bins.scad",
    });
    const model = await plugin.generate(params, ctx);
    expect(model).toMatchObject({ path: join(ctx.workDir, "model.stl"), meta: { params } });
    const args = engineArgs(bin, "openscad");
    expect(args.slice(0, 2)).toEqual(["-o", join(ctx.workDir, "model.stl")]);
    expect(args.at(-1)).toBe("/scad/bins.scad");
    const defines = ["gridx=2", "gridy=3", "gridz=6", "divx=1", "divy=2", "scoop=1", "style_tab=5"];
    for (const define of [...defines, "refined_holes=false"]) {
      expect(args).toContain(define);
    }
    expect(args).toContain("magnet_holes=true");
    expect(args).toContain("include_lip=false");
  });

  test("reports a failing OpenSCAD run with the tail of its stderr", async () => {
    const { ctx, bin } = setup();
    const openscad = fakeEngine(bin, "openscad", "echo 'parse error in bins.scad' >&2; exit 3");
    const plugin = await load({ CONVEYOR_ENGINE_STUB: undefined, OPENSCAD_BIN: openscad });
    const err = await plugin.generate({ ...params, labelTab: true }, ctx).catch((e: unknown) => e);
    expect((err as StageError).reason).toMatch(/exited 3: parse error in bins\.scad/);
  });

  test("reports an OpenSCAD binary that cannot start", async () => {
    const { ctx, bin } = setup();
    const plugin = await load({
      CONVEYOR_ENGINE_STUB: undefined,
      OPENSCAD_BIN: join(bin, "missing"),
    });
    const err = await plugin.generate(params, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StageError);
    expect((err as StageError).stage).toBe("generator");
  });
});
