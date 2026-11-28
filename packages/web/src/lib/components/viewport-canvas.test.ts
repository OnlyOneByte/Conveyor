import { describe, expect, test } from "bun:test";
import { hasWebGL, memoiseImport, NO_WEBGL } from "./viewport-canvas.js";

const canvasWith = (contexts: Record<string, unknown>) => {
  const asked: string[] = [];
  const make = () => ({
    getContext: (kind: string) => {
      asked.push(kind);
      return contexts[kind] ?? null;
    },
  });
  return { make, asked };
};

describe("hasWebGL", () => {
  test("WebGL 2 is enough, and WebGL 1 isn't asked for then", () => {
    const { make, asked } = canvasWith({ webgl2: {} });
    expect(hasWebGL(make)).toBe(true);
    expect(asked).toEqual(["webgl2"]);
  });

  test("falls back to WebGL 1 when WebGL 2 is off", () => {
    const { make, asked } = canvasWith({ webgl: {} });
    expect(hasWebGL(make)).toBe(true);
    expect(asked).toEqual(["webgl2", "webgl"]);
  });

  test("a browser with WebGL turned off has none", () => {
    expect(hasWebGL(canvasWith({}).make)).toBe(false);
  });

  test("a canvas that throws counts as no WebGL, not an error page", () => {
    const broken = () => ({
      getContext: (): unknown => {
        throw new Error("Error creating WebGL context.");
      },
    });
    expect(hasWebGL(broken)).toBe(false);
    expect(
      hasWebGL(() => {
        throw new Error("no canvas");
      }),
    ).toBe(false);
  });

  test("the placeholder says why the preview is missing", () => {
    expect(NO_WEBGL).toBe("The 3D preview needs WebGL, which this browser has turned off.");
  });
});

describe("memoiseImport", () => {
  test("imports once and hands every caller the same promise", async () => {
    let calls = 0;
    const load = memoiseImport(async () => {
      calls++;
      return { default: "canvas" };
    });
    const first = load();
    const second = load();
    expect(second).toBe(first);
    expect(await first).toEqual({ default: "canvas" });
    expect(load()).toBe(first);
    expect(calls).toBe(1);
  });

  test("passes a failed import to its caller, then lets the next call try again", async () => {
    let calls = 0;
    const load = memoiseImport(async () => {
      calls++;
      if (calls === 1) throw new Error("chunk failed");
      return { default: "canvas" };
    });
    await expect(load()).rejects.toThrow("chunk failed");
    expect(await load()).toEqual({ default: "canvas" });
    expect(calls).toBe(2);
  });

  test("a failed early load nobody awaits raises no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", record);
    try {
      const load = memoiseImport(() => Promise.reject(new Error("chunk failed")));
      void load();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });
});
