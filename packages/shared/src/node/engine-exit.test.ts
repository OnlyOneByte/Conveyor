import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { testCtx } from "../../test/helpers/index.ts";
import { StageError } from "../context";
import { ENGINE_LOG, runEngine } from "./engine";

async function reasonOf(run: Promise<unknown>): Promise<string> {
  const error = await run.then(
    () => undefined,
    (err: unknown) => err,
  );
  if (error instanceof StageError) return error.reason;
  throw new Error("expected a StageError");
}

describe("runEngine's exit and stderr", () => {
  test("an engine killed by a signal names the signal and points at the engine log", async () => {
    const ctx = testCtx();
    try {
      const reason = await reasonOf(runEngine("slicer", "sh", ["-c", "kill -KILL $$"], ctx));
      expect(reason).toBe("sh killed by SIGKILL: nothing on stderr, see engine.log");
      expect(readFileSync(join(ctx.workDir, ENGINE_LOG), "utf8")).toEndWith(
        "[killed by SIGKILL]\n",
      );
    } finally {
      ctx.cleanup();
    }
  });

  test("a killed engine that wrote to stderr keeps the stderr tail", async () => {
    const ctx = testCtx();
    try {
      const script = "echo 'out of memory' >&2; kill -TERM $$";
      const reason = await reasonOf(runEngine("generator", "sh", ["-c", script], ctx));
      expect(reason).toBe("sh killed by SIGTERM: out of memory\n");
    } finally {
      ctx.cleanup();
    }
  });

  test("keeps only the last 2048 characters of a long stderr", async () => {
    const ctx = testCtx();
    try {
      const script = "head -c 100000 /dev/zero | tr '\\0' x >&2; echo end >&2";
      const { stderr } = await runEngine("slicer", "sh", ["-c", script], ctx);
      expect(stderr).toHaveLength(2048);
      expect(stderr).toEndWith("xxend\n");
    } finally {
      ctx.cleanup();
    }
  });

  test("a character split across two stderr chunks is decoded whole", async () => {
    const ctx = testCtx();
    try {
      const script = "printf '\\342' >&2; sleep 0.2; printf '\\202\\254\\n' >&2";
      const { stderr } = await runEngine("slicer", "sh", ["-c", script], ctx);
      expect(stderr).toBe("€\n");
      expect(readFileSync(join(ctx.workDir, ENGINE_LOG), "utf8")).toContain("€\n[exited 0]");
    } finally {
      ctx.cleanup();
    }
  });
});
