import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StageError } from "@conveyor/shared";
import {
  engineArgs,
  fakeEngine,
  setEnv,
  testCtx,
} from "../../../../packages/shared/test/helpers/index.ts";
import { prusa } from "./index.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const model = { path: "/work/model.stl", format: "stl" as const };

async function setup(env: Record<string, string | undefined>, prusaBody = "") {
  const ctx = testCtx();
  const dir = mkdtempSync(join(tmpdir(), "conveyor-prusa-"));
  cleanups.push(ctx.cleanup, () => rmSync(dir, { recursive: true, force: true }));
  const bin = fakeEngine(dir, "prusa-slicer", prusaBody);
  cleanups.push(setEnv({ PRUSA_BIN: bin, ...env }));
  const profileDir = (files: string[]) => {
    const path = join(dir, "profile");
    mkdirSync(path);
    for (const f of files) writeFileSync(join(path, f), "");
    return { id: "prusa/p", name: "P", path };
  };
  return { ctx, dir, profileDir, plugin: prusa };
}

const real = { CONVEYOR_ENGINE_STUB: undefined };
const writesOutput = 'p=; for a; do [ "$p" = --output ] && echo "G1 Y2" > "$a"; p=$a; done';

describe("the prusa slicer", () => {
  test("writes stub g-code when the engine stub is on", async () => {
    const { ctx, plugin } = await setup({ CONVEYOR_ENGINE_STUB: "1" });
    const gcode = await plugin.slice(model, { id: "prusa/p", name: "P", path: "/none" }, ctx);
    expect(gcode.meta).toEqual({ profileId: "prusa/p", stub: true });
    expect(readFileSync(gcode.path, "utf8")).toContain("; source=/work/model.stl");
  });

  test("loads only config.ini when the bundle has one", async () => {
    const { ctx, dir, profileDir, plugin } = await setup(real, writesOutput);
    const profile = profileDir(["printer.ini", "config.ini", "notes.txt"]);
    const gcode = await plugin.slice(model, profile, ctx);
    expect(readFileSync(gcode.path, "utf8")).toBe("G1 Y2\n");
    expect(engineArgs(dir, "prusa-slicer")).toEqual([
      "--load",
      join(profile.path, "config.ini"),
      "--export-gcode",
      "--output",
      join(ctx.workDir, "model.gcode"),
      "/work/model.stl",
    ]);
  });

  test("loads every .ini in name order when there is no config.ini", async () => {
    const { ctx, dir, profileDir, plugin } = await setup(real, writesOutput);
    const profile = profileDir(["print.ini", "Filament.INI", "printer.ini"]);
    await plugin.slice(model, profile, ctx);
    const loads = engineArgs(dir, "prusa-slicer").filter((_, i, a) => a[i - 1] === "--load");
    expect(loads).toEqual(
      ["Filament.INI", "print.ini", "printer.ini"].map((f) => join(profile.path, f)),
    );
  });

  test("refuses a missing bundle or one with no .ini", async () => {
    const { ctx, profileDir, plugin } = await setup(real);
    const missing = await plugin
      .slice(model, { id: "prusa/p", name: "P", path: "/no/such/bundle" }, ctx)
      .catch((e: unknown) => e);
    expect((missing as StageError).reason).toContain("profile bundle not found at /no/such/bundle");
    const empty = profileDir(["notes.txt"]);
    const none = await plugin.slice(model, empty, ctx).catch((e: unknown) => e);
    expect((none as StageError).reason).toBe(
      `no .ini config found in profile bundle ${empty.path}`,
    );
  });

  test("reports a failing PrusaSlicer run with the tail of its stderr", async () => {
    const { ctx, profileDir, plugin } = await setup(real, "echo 'object outside bed' >&2; exit 1");
    const err = await plugin.slice(model, profileDir(["config.ini"]), ctx).catch((e: unknown) => e);
    expect((err as StageError).stage).toBe("slicer");
    expect((err as StageError).reason).toMatch(/exited 1: object outside bed/);
  });
});
