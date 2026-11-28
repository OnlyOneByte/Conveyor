import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { testCtx } from "../../test/helpers/index.ts";
import { StageError } from "../context";
import { ENGINE_LOG, requireOutput, runEngine } from "./engine";

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

  test("counts the kept stderr and its tail in code points, so neither starts mid-character", async () => {
    const ctx = testCtx();
    const emoji = "\u{1F600}";
    const script =
      "i=0; while [ $i -lt 3000 ]; do printf '\\360\\237\\230\\200'; i=$((i+1)); done >&2";
    try {
      const { stderr } = await runEngine("slicer", "sh", ["-c", `${script}; printf a >&2`], ctx);
      expect(Array.from(stderr)).toHaveLength(2048);
      expect(stderr).toBe(`${emoji.repeat(2047)}a`);
      const reason = await reasonOf(runEngine("slicer", "sh", ["-c", `${script}; exit 1`], ctx));
      expect(reason).toBe(`sh exited 1: ${emoji.repeat(500)}`);
    } finally {
      ctx.cleanup();
    }
  });

  test("requireOutput's stderr tail is 500 code points too", async () => {
    const emoji = "\u{1F600}";
    const ctx = testCtx();
    try {
      const missing = join(ctx.workDir, "none.gcode");
      const said = emoji.repeat(600);
      const reason = await reasonOf(requireOutput("slicer", missing, "no G-code", said));
      expect(reason).toBe(`no G-code: ${emoji.repeat(500)}`);
    } finally {
      ctx.cleanup();
    }
  });

  test("a character cut off when the engine exits is flushed as one replacement character", async () => {
    const ctx = testCtx();
    try {
      const { stderr } = await runEngine("slicer", "sh", ["-c", "printf 'ok\\342\\202' >&2"], ctx);
      expect(stderr).toBe("ok�");
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
