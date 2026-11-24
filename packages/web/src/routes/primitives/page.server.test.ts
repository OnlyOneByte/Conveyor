import { describe, expect, test } from "bun:test";
import { isHttpError } from "@sveltejs/kit";
import { load, ssr } from "./+page.server";

describe("/primitives outside capture builds", () => {
  test("renders on the server, so its load's 404 is the response status", () => {
    expect(process.env.VITE_CONVEYOR_PRIMITIVES).toBeUndefined();
    expect(ssr).toBe(true);
    let thrown: unknown;
    try {
      load();
    } catch (err) {
      thrown = err;
    }
    expect(isHttpError(thrown, 404)).toBe(true);
  });
});
