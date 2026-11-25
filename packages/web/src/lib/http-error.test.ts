import { describe, expect, test } from "bun:test";
import { fetchCatalogProfiles } from "./api.js";
import { failure, Unreachable, unreachable } from "./http-error.js";

const answering = (status: number, body: BodyInit | null, type = "application/json") =>
  Object.assign(async () => new Response(body, { status, headers: { "content-type": type } }), {
    preconnect: fetch.preconnect,
  });

describe("a failed request", () => {
  test("carries the server's error message", async () => {
    const locked = answering(500, JSON.stringify({ error: "database is locked" }));
    await expect(fetchCatalogProfiles(locked)).rejects.toThrow("database is locked");
  });

  test("falls back to the method, path and status when the body has no message", async () => {
    for (const body of ["<html>oops</html>", JSON.stringify({ error: "" }), JSON.stringify({})]) {
      const err = await failure(new Response(body, { status: 500 }), "GET /api/catalog/profiles");
      expect(err.message).toBe("GET /api/catalog/profiles 500");
      expect(unreachable(err)).toBe(false);
    }
  });

  test("reads 502, 503 and 504 from the proxy as Conveyor being unreachable", async () => {
    for (const status of [502, 503, 504]) {
      const down = answering(status, "Bad Gateway", "text/plain");
      const err = await fetchCatalogProfiles(down).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Unreachable);
      expect(unreachable(err)).toBe(true);
    }
  });

  test("treats a network failure as unreachable, and other statuses as answers", async () => {
    expect(unreachable(new TypeError("fetch failed"))).toBe(true);
    const refused = await failure(new Response(null, { status: 409 }), "GET /x");
    expect(unreachable(refused)).toBe(false);
  });
});
