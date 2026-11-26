import { expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { testCtx } from "../../test/helpers/index.ts";
import { ENGINE_LOG, ENGINE_LOG_MAX_BYTES, runEngine } from "./engine";

test("an engine run writes its command, stdout, stderr and exit to engine.log", async () => {
  const ctx = testCtx();
  try {
    await runEngine("slicer", "sh", ["-c", "echo sliced; echo warned >&2"], ctx);
    await runEngine("slicer", "sh", ["-c", "echo boom >&2; exit 3"], ctx).catch(() => undefined);
    const lines = (await readFile(join(ctx.workDir, ENGINE_LOG), "utf8")).split("\n");
    expect(lines[0]).toBe("$ sh -c echo sliced; echo warned >&2");
    expect(lines.slice(1, 3).sort()).toEqual(["sliced", "warned"]);
    expect(lines.slice(3)).toEqual([
      "[exited 0]",
      "$ sh -c echo boom >&2; exit 3",
      "boom",
      "[exited 3]",
      "",
    ]);
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

test("the cap covers the job's whole engine.log, across every run", async () => {
  const ctx = testCtx();
  try {
    const big = `head -c ${3 * 1024 * 1024} /dev/zero | tr '\\0' x`;
    await runEngine("generator", "sh", ["-c", big], ctx);
    await runEngine("slicer", "sh", ["-c", big], ctx);
    await runEngine("slicer", "sh", ["-c", "echo after the cap"], ctx);
    const path = join(ctx.workDir, ENGINE_LOG);
    const note = `\n[engine log cut off at ${ENGINE_LOG_MAX_BYTES} bytes]\n`;
    expect((await stat(path)).size).toBe(ENGINE_LOG_MAX_BYTES + note.length);
    const log = await readFile(path, "utf8");
    expect(log).toEndWith(note);
    expect(log).not.toContain("after the cap");
  } finally {
    ctx.cleanup();
  }
});

test("a work directory that can't hold the log never fails the run, and says so once", async () => {
  const ctx = testCtx();
  try {
    const gone = { ...ctx, workDir: join(ctx.workDir, "missing") };
    await expect(runEngine("slicer", "sh", ["-c", "echo ok; echo more"], gone)).resolves.toEqual({
      stderr: "",
    });
    expect(ctx.logs).toHaveLength(1);
    expect(ctx.logs[0]).toStartWith("engine log not written, the job still runs: ");
    expect(ctx.logs[0]).toContain("ENOENT");
  } finally {
    ctx.cleanup();
  }
});

test("the lease is checked once the engine has run, whatever its exit code", async () => {
  const ctx = testCtx();
  const lost = new Error("job lease lost");
  const ran = join(ctx.workDir, "engine-ran");
  const withLease = {
    ...ctx,
    checkLease: () => {
      if (existsSync(ran)) throw lost;
    },
  };
  try {
    for (const code of [0, 3]) {
      rmSync(ran, { force: true });
      const engine = runEngine("slicer", "sh", ["-c", `touch "$0"; exit ${code}`, ran], withLease);
      await expect(engine).rejects.toBe(lost);
    }
    rmSync(ran, { force: true });
    const unchecked = runEngine("slicer", "sh", ["-c", 'touch "$0"', ran], ctx);
    await expect(unchecked).resolves.toEqual({ stderr: "" });
  } finally {
    ctx.cleanup();
  }
});
