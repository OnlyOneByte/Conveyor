import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { StageError } from "@conveyor/shared";
import {
  engineArgs,
  fakeEngine,
  setEnv,
  testCtx,
} from "../../../../packages/shared/test/helpers/index.ts";
import { orca } from "./index.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const model = { path: "/work/model.stl", format: "stl" as const };
const profile = { id: "orca/p", name: "P", path: "/profiles/p" };

async function setup(env: Record<string, string | undefined>, orcaBody = "") {
  const ctx = testCtx();
  const bin = mkdtempSync(join(tmpdir(), "conveyor-orca-"));
  cleanups.push(ctx.cleanup, () => rmSync(bin, { recursive: true, force: true }));
  fakeEngine(bin, "xvfb-run", 'shift; exec "$@"');
  const orcaBin = fakeEngine(bin, "orca-slicer", orcaBody);
  cleanups.push(
    setEnv({
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      ORCA_BIN: orcaBin,
      ORCA_DATADIR: "/orca/profiles",
      ...env,
    }),
  );
  return { ctx, bin, plugin: orca };
}

describe("the orca slicer", () => {
  test("writes stub g-code naming the profile when the engine stub is on", async () => {
    const { ctx, plugin } = await setup({ CONVEYOR_ENGINE_STUB: "1" });
    const gcode = await plugin.slice(model, profile, ctx);
    expect(gcode.meta).toEqual({ profileId: "orca/p", stub: true });
    expect(readFileSync(gcode.path, "utf8")).toContain("; profile=orca/p");
  });

  test("runs Orca under xvfb with the profile's three files and keeps plate 1", async () => {
    const { ctx, bin, plugin } = await setup(
      { CONVEYOR_ENGINE_STUB: undefined },
      'p=; for a; do [ "$p" = --outputdir ] && echo "G1 X1" > "$a/plate_1.gcode"; p=$a; done',
    );
    const gcode = await plugin.slice(model, profile, ctx);
    expect(gcode).toEqual({
      path: join(ctx.workDir, "model.gcode"),
      format: "gcode",
      meta: { profileId: "orca/p" },
    });
    expect(readFileSync(gcode.path, "utf8")).toBe("G1 X1\n");
    expect(engineArgs(bin, "xvfb-run").slice(0, 2)).toEqual(["-a", join(bin, "orca-slicer")]);
    expect(engineArgs(bin, "orca-slicer")).toEqual([
      "--datadir",
      "/orca/profiles",
      "--load-settings",
      "/profiles/p/machine.json;/profiles/p/process.json",
      "--load-filaments",
      "/profiles/p/filament.json",
      "--slice",
      "0",
      "--outputdir",
      ctx.workDir,
      "/work/model.stl",
    ]);
  });

  test("reports a failing Orca run with the tail of its stderr", async () => {
    const { ctx, plugin } = await setup(
      { CONVEYOR_ENGINE_STUB: undefined },
      "echo 'no printer preset' >&2; exit 2",
    );
    const err = await plugin.slice(model, profile, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StageError);
    expect((err as StageError).reason).toMatch(/exited 2: no printer preset/);
  });

  test("fails the slice when Orca exits 0 without writing plate 1, quoting its stderr", async () => {
    const { ctx, bin, plugin } = await setup(
      { CONVEYOR_ENGINE_STUB: undefined },
      "echo 'Nothing to be sliced' >&2; exit 0",
    );
    const err = await plugin.slice(model, profile, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StageError);
    expect((err as StageError).stage).toBe("slicer");
    expect((err as StageError).reason).toBe(
      `${join(bin, "orca-slicer")} exited 0 but wrote no G-code: Nothing to be sliced`,
    );
  });

  test("fails the slice when Orca leaves an empty plate 1", async () => {
    const { ctx, plugin } = await setup(
      { CONVEYOR_ENGINE_STUB: undefined },
      'p=; for a; do [ "$p" = --outputdir ] && : > "$a/plate_1.gcode"; p=$a; done',
    );
    const err = await plugin.slice(model, profile, ctx).catch((e: unknown) => e);
    expect((err as StageError).reason).toEndWith(
      "exited 0 but wrote no G-code (the file is empty)",
    );
  });
});
