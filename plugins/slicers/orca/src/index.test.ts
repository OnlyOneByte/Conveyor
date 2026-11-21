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

let n = 0;
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
  const orca = fakeEngine(bin, "orca-slicer", orcaBody);
  cleanups.push(
    setEnv({
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      ORCA_BIN: orca,
      ORCA_DATADIR: "/orca/profiles",
      ...env,
    }),
  );
  const mod: typeof import("./index.ts") = await import(`./index.ts?case=${++n}`);
  return { ctx, bin, plugin: mod.orca };
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
});
