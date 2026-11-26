import { expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { testCtx } from "../../test/helpers/index.ts";
import { ENGINE_LOG, ENGINE_LOG_MAX_BYTES, runEngine } from "./engine";

test("an engine run writes its command, stdout, stderr and exit to engine.log", async () => {
  const ctx = testCtx();
  try {
    await runEngine("slicer", "sh", ["-c", "echo sliced; echo warned >&2"], ctx);
    await runEngine("slicer", "sh", ["-c", "echo boom >&2; exit 3"], ctx).catch(() => undefined);
    const log = await readFile(join(ctx.workDir, ENGINE_LOG), "utf8");
    expect(log).toBe(
      [
        "$ sh -c echo sliced; echo warned >&2",
        "sliced",
        "warned",
        "[exited 0]",
        "$ sh -c echo boom >&2; exit 3",
        "boom",
        "[exited 3]",
        "",
      ].join("\n"),
    );
  } finally {
    ctx.cleanup();
  }
});

test("an engine that cannot start says so in engine.log", async () => {
  const ctx = testCtx();
  try {
    await runEngine("generator", "/nonexistent/engine", [], ctx).catch(() => undefined);
    const log = await readFile(join(ctx.workDir, ENGINE_LOG), "utf8");
    expect(log).toStartWith("$ /nonexistent/engine\n[");
    expect(log).toContain("ENOENT");
  } finally {
    ctx.cleanup();
  }
});

test("engine.log stops at its size cap and says it was cut off", async () => {
  const ctx = testCtx();
  try {
    const bytes = ENGINE_LOG_MAX_BYTES + 100_000;
    await runEngine("slicer", "sh", ["-c", `head -c ${bytes} /dev/zero | tr '\\0' x`], ctx);
    const log = await readFile(join(ctx.workDir, ENGINE_LOG), "utf8");
    const note = `\n[engine log cut off at ${ENGINE_LOG_MAX_BYTES} bytes]\n`;
    expect(log).toEndWith(note);
    expect((await stat(join(ctx.workDir, ENGINE_LOG))).size).toBe(
      ENGINE_LOG_MAX_BYTES + note.length,
    );
  } finally {
    ctx.cleanup();
  }
});

test("a work directory that can't hold the log never fails the engine run", async () => {
  const ctx = testCtx();
  try {
    const gone = { ...ctx, workDir: join(ctx.workDir, "missing") };
    await expect(runEngine("slicer", "sh", ["-c", "echo ok"], gone)).resolves.toEqual({
      stderr: "",
    });
  } finally {
    ctx.cleanup();
  }
});
