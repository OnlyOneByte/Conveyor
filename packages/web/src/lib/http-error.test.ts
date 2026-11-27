import { describe, expect, test } from "bun:test";
import { fetchCatalogProfiles } from "./api.js";
import { failure, fieldOf, MESSAGE_MAX, shown, Unreachable, unreachable } from "./http-error.js";

const answering = (status: number, body: BodyInit | null, type = "application/json") =>
  Object.assign(async () => new Response(body, { status, headers: { "content-type": type } }), {
    preconnect: fetch.preconnect,
  });

describe("a failed request", () => {
  test("carries the server's error message", async () => {
    const locked = answering(500, JSON.stringify({ error: "database is locked" }));
    await expect(fetchCatalogProfiles(locked)).rejects.toThrow("database is locked");
  });

  test("carries the field the server names, and only a non-empty string one", async () => {
    const said = (body: object) =>
      failure(new Response(JSON.stringify(body), { status: 409 }), "PUT /api/catalog/printers");
    const named = await said({ error: "enter them again", field: "secrets" });
    expect([named.message, fieldOf(named)]).toEqual(["enter them again", "secrets"]);
    for (const field of [undefined, "", 7, null])
      expect(fieldOf(await said({ error: "x", field }))).toBeNull();
    expect(fieldOf(new Error("plain"))).toBeNull();
  });

  test("falls back to the method, path and status when the body has no message", async () => {
    const blank = JSON.stringify({ error: " \n\t " });
    for (const body of [
      "<html>oops</html>",
      JSON.stringify({ error: "" }),
      JSON.stringify({}),
      blank,
    ]) {
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

describe("a server message", () => {
  test("is trimmed", async () => {
    const err = await failure(
      Response.json({ error: "  database is locked \n" }, { status: 500 }),
      "GET /x",
    );
    expect(err.message).toBe("database is locked");
  });

  test("is cut to about 300 characters with an ellipsis", async () => {
    const long = "x".repeat(200_000);
    const err = await failure(Response.json({ error: long }, { status: 500 }), "GET /x");
    expect(err.message.length).toBe(MESSAGE_MAX);
    expect(err.message.endsWith("…")).toBe(true);
    expect(shown("y".repeat(MESSAGE_MAX))).toBe("y".repeat(MESSAGE_MAX));
  });

  test("reaches the put and delete helpers too", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async () => Response.json({ error: `  ${"z".repeat(1000)}` }, { status: 409 }),
      { preconnect: real.preconnect },
    );
    try {
      const { saveProfile } = await import("./api.js");
      const { deleteProfile } = await import("./api-delete.js");
      for (const call of [
        () => deleteProfile("a"),
        () =>
          saveProfile({
            id: "a",
            slicerId: "orca",
            name: "A",
            path: "/profiles/a",
            gcodeFlavor: "klipper",
          }),
      ]) {
        const err = await call().catch((e: unknown) => e);
        expect(err instanceof Error && err.message.length).toBe(MESSAGE_MAX);
      }
    } finally {
      globalThis.fetch = real;
    }
  });
});
