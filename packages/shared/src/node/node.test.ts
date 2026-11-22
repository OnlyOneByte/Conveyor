import { describe, expect, test } from "bun:test";
import { join, sep } from "node:path";
import { testCtx } from "../../test/helpers/index.ts";
import { StageError } from "../context";
import { runEngine } from "./engine";
import { isWithin } from "./paths";

async function stageErrorOf(run: Promise<void>) {
  try {
    await run;
  } catch (error) {
    if (error instanceof StageError) return { stage: error.stage, reason: error.reason };
    throw error;
  }
  throw new Error("expected a StageError");
}

describe("runEngine", () => {
  test("resolves when the engine exits 0", async () => {
    const ctx = testCtx();
    try {
      await expect(runEngine("slicer", "sh", ["-c", "exit 0"], ctx)).resolves.toBeUndefined();
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
      expect(error).toEqual({ stage: "slicer", reason: "sh exited 1: " });
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
