import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { testCtx } from "../../test/helpers/index.ts";
import { runEngine } from "./engine";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(check: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`${what} within ${ms} ms`);
    await Bun.sleep(5);
  }
}

test("an abort stops the engine's whole process group, so a wrapped engine writes nothing late", async () => {
  const ctx = testCtx();
  const inner = join(ctx.workDir, "inner.sh");
  const pidFile = join(ctx.workDir, "grandchild.pid");
  const late = join(ctx.workDir, "late");
  writeFileSync(inner, `echo $$ > "${pidFile}"\nsleep 2\ntouch "${late}"\n`);
  try {
    const run = runEngine("slicer", "sh", ["-c", 'sh "$0" & wait', inner], ctx).catch(
      (err: unknown) => err,
    );
    await until(
      () => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "",
      3000,
      "the wrapped engine never started",
    );
    const grandchild = Number(readFileSync(pidFile, "utf8").trim());
    ctx.abort();
    expect(await run).toBeInstanceOf(Error);
    await until(() => !alive(grandchild), 1000, "the wrapped engine outlived the abort");
    expect(existsSync(late)).toBe(false);
  } finally {
    ctx.cleanup();
  }
});
