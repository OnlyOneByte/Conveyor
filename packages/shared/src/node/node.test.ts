import { describe, expect, test } from "bun:test";
import { join, sep } from "node:path";
import { testCtx } from "../../test/helpers/index.ts";
import { StageError } from "../context";
import { requireOutput, runEngine } from "./engine";
import { isWithin } from "./paths";

async function stageErrorOf(run: Promise<unknown>) {
  try {
    await run;
  } catch (error) {
    if (error instanceof StageError) return { stage: error.stage, reason: error.reason };
    throw error;
  }
  throw new Error("expected a StageError");
}

describe("runEngine", () => {
  test("resolves with the whole stderr when the engine exits 0", async () => {
    const ctx = testCtx();
    try {
      await expect(runEngine("slicer", "sh", ["-c", "exit 0"], ctx)).resolves.toEqual({
        stderr: "",
      });
      const script = `printf '%0600d' 0 >&2; echo 'All objects are outside of the print volume.' >&2`;
      const { stderr } = await runEngine("slicer", "sh", ["-c", script], ctx);
      expect(stderr).toEndWith("All objects are outside of the print volume.\n");
      expect(stderr.length).toBe(600 + "All objects are outside of the print volume.\n".length);
    } finally {
      ctx.cleanup();
    }
  });

  test("a non-zero exit is a StageError for the given stage with the stderr tail", async () => {
    const ctx = testCtx();
    try {
      const script = `printf '%0600d' 0 >&2; echo boom >&2; exit 3`;
      const error = await stageErrorOf(runEngine("generator", "sh", ["-c", script], ctx));
      expect(error.stage).toBe("generator");
      expect(error.reason).toStartWith("sh exited 3: ");
      expect(error.reason).toEndWith("boom\n");
      expect(error.reason.length).toBe("sh exited 3: ".length + 500);
    } finally {
      ctx.cleanup();
    }
  });

  test("any non-zero exit code rejects", async () => {
    const ctx = testCtx();
    try {
      const error = await stageErrorOf(runEngine("slicer", "sh", ["-c", "exit 1"], ctx));
      expect(error).toEqual({
        stage: "slicer",
        reason: "sh exited 1: nothing on stderr, see engine.log",
      });
    } finally {
      ctx.cleanup();
    }
  });

  test("an engine that cannot start is a StageError for the given stage", async () => {
    const ctx = testCtx();
    try {
      const error = await stageErrorOf(runEngine("generator", "/nonexistent/engine", [], ctx));
      expect(error.stage).toBe("generator");
      expect(error.reason).toContain("ENOENT");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("isWithin", () => {
  const root = join(sep, "data", "root");

  test.each([
    ["the root itself", root, true],
    ["a file below the root", join(root, "a", "b.stl"), true],
    ["a sibling sharing a prefix", `${root}-other${sep}x`, false],
    ["the parent", join(root, ".."), false],
    ["an escape through ..", join(root, "..", "etc"), false],
    ["a file named like ..", join(root, "..file"), true],
  ])("%s → %p", (_label, candidate, expected) => {
    expect(isWithin(root, candidate)).toBe(expected);
  });
});

describe("requireOutput", () => {
  test("passes a non-empty file and refuses a missing one, an empty one or a directory", async () => {
    const ctx = testCtx();
    try {
      const out = join(ctx.workDir, "model.gcode");
      await Bun.write(out, "G28\n");
      await expect(requireOutput("slicer", out, "no G-code")).resolves.toBeUndefined();
      const missing = join(ctx.workDir, "none.gcode");
      expect(
        await stageErrorOf(requireOutput("slicer", missing, "no G-code", "  said this \n")),
      ).toEqual({
        stage: "slicer",
        reason: "no G-code: said this",
      });
      await Bun.write(out, "");
      expect(await stageErrorOf(requireOutput("slicer", out, "no G-code"))).toEqual({
        stage: "slicer",
        reason: "no G-code (the file is empty)",
      });
      expect(await stageErrorOf(requireOutput("generator", ctx.workDir, "no STL"))).toEqual({
        stage: "generator",
        reason: "no STL",
      });
    } finally {
      ctx.cleanup();
    }
  });

  test("quotes only the last 500 characters of stderr, however long it is", async () => {
    const ctx = testCtx();
    try {
      const said = `${"x".repeat(5000)}All objects are outside of the print volume.`;
      const missing = join(ctx.workDir, "none.gcode");
      const { reason } = await stageErrorOf(requireOutput("slicer", missing, "no G-code", said));
      expect(reason).toBe(`no G-code: ${said.slice(-500)}`);
      expect(reason).toEndWith("All objects are outside of the print volume.");
    } finally {
      ctx.cleanup();
    }
  });
});
