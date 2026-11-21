import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StageError } from "@conveyor/shared";
import { setEnv, testCtx } from "../../../../packages/shared/test/helpers/index.ts";

const data = mkdtempSync(join(tmpdir(), "conveyor-uploads-"));
mkdirSync(join(data, "uploads"));
let plugin: typeof import("./index.ts")["passthrough"];
let restoreEnv = () => {};
const cleanups: (() => void)[] = [];

beforeAll(async () => {
  restoreEnv = setEnv({ DATA_DIR: data, UPLOAD_DIR: undefined });
  const fresh = "./index.ts?uploads=temp";
  const mod: typeof import("./index.ts") = await import(fresh);
  plugin = mod.passthrough;
});
afterAll(() => {
  restoreEnv();
  rmSync(data, { recursive: true, force: true });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup() {
  const ctx = testCtx();
  cleanups.push(ctx.cleanup);
  return { ctx, data, plugin };
}

describe("the passthrough generator", () => {
  test("copies the uploaded STL into the work directory", async () => {
    const { ctx, data, plugin } = setup();
    writeFileSync(join(data, "uploads", "u1.stl"), "solid u1");
    const model = await plugin.generate({ uploadId: "u1", filename: "part.stl" }, ctx);
    expect(model).toEqual({
      path: join(ctx.workDir, "model.stl"),
      format: "stl",
      meta: { uploadId: "u1", filename: "part.stl" },
    });
    expect(readFileSync(model.path, "utf8")).toBe("solid u1");
  });

  test("refuses an upload id that names a path", async () => {
    const { ctx, data, plugin } = setup();
    writeFileSync(join(data, "secret.stl"), "secret");
    const err = await plugin
      .generate({ uploadId: "../secret", filename: "x.stl" }, ctx)
      .catch((e: unknown) => e);
    expect((err as StageError).reason).toContain("uploadId must be a url-safe id");
  });

  test("refuses a missing upload or params that do not parse", async () => {
    const { ctx, plugin } = setup();
    const missing = await plugin
      .generate({ uploadId: "nope", filename: "x.stl" }, ctx)
      .catch((e: unknown) => e);
    expect((missing as StageError).reason).toBe("upload not found: nope");
    const bad = { uploadId: 1 } as unknown as { uploadId: string };
    const invalid = await plugin.generate(bad, ctx).catch((e: unknown) => e);
    expect(invalid).toBeInstanceOf(StageError);
  });
});
