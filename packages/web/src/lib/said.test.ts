import { describe, expect, test } from "bun:test";
import { submitJob, uploadStl } from "./api";
import { statusError, Unreachable } from "./http-error";
import { couldnt, FAILED, NOT_LOADED, said, saidOnLoad, serverSaid, UNREACHABLE } from "./said";

const down = (status: number) => Object.assign(async () => new Response("Bad Gateway", { status }), { preconnect: fetch.preconnect });

describe("what the page says about a failure", () => {
  test("keeps the server's own message", () => {
    expect(said(new Error("printer elegoo-1 is busy"))).toBe("printer elegoo-1 is busy");
    expect(couldnt("save Voron", new Error("database is locked"))).toBe("Couldn't save Voron: database is locked");
  });

  test("never shows a method, path and status line, or a stock status text", () => {
    const lines = ["GET /api/catalog/profiles 500", "POST /jobs 500", "PUT /api/catalog/printers 409", "PATCH /api/x 400", "DELETE /api/x 404", "Internal Server Error"];
    for (const line of lines) {
      expect(serverSaid(new Error(line))).toBeNull();
      expect(said(new Error(line))).toBe(FAILED);
      expect(couldnt("upload cube.stl", new Error(line))).toBe("Couldn't upload cube.stl. Try again.");
    }
  });

  test("reads a network failure or a gateway answer as Conveyor being unreachable", () => {
    for (const e of [new TypeError("Failed to fetch"), new Unreachable("POST /jobs 502"), statusError(new Response(null, { status: 503 }), "GET /x")]) {
      expect(said(e)).toBe(UNREACHABLE);
      expect(saidOnLoad(e)).toBe(UNREACHABLE);
      expect(couldnt("save Voron", e)).toBe("Couldn't save Voron. Can't reach Conveyor. Check your connection, then try again.");
    }
  });

  test("says a page didn't load when the user did nothing", () => {
    expect(saidOnLoad(new Error("GET /api/catalog/profiles 500"))).toBe(NOT_LOADED);
    expect(saidOnLoad(new Error("database is locked"))).toBe("database is locked");
  });

  test("treats an empty message as no message", () => {
    expect(said(new Error("  "))).toBe(FAILED);
  });
});

describe("a plain status throw", () => {
  test("is Unreachable only for 502, 503 and 504", () => {
    for (const status of [502, 503, 504]) expect(statusError(new Response(null, { status }), "GET /x")).toBeInstanceOf(Unreachable);
    const other = statusError(new Response(null, { status: 500 }), "GET /x");
    expect(other).not.toBeInstanceOf(Unreachable);
    expect(other.message).toBe("GET /x 500");
  });

  test("Print and upload read a gateway answer as unreachable", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = down(502);
    try {
      const sent = await submitJob({ generator: { id: "g", params: {} }, printerId: "p", profileId: "r" }).catch((e: unknown) => e);
      const uploaded = await uploadStl(new File(["solid"], "cube.stl")).catch((e: unknown) => e);
      expect(said(sent)).toBe(UNREACHABLE);
      expect(said(uploaded)).toBe(UNREACHABLE);
    } finally {
      globalThis.fetch = real;
    }
  });
});
