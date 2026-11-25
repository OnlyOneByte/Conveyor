import { describe, expect, test } from "bun:test";
import { submitJob, uploadStl } from "./api";
import { statusError, Unreachable } from "./http-error";
import { couldnt, detailOf, FAILED, NOT_LOADED, STOPPED, said, saidOnLoad, serverSaid, UNREACHABLE } from "./said";

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

  test("a gateway answer means Conveyor isn't running, a network failure means the connection", () => {
    for (const e of [new Unreachable("POST /jobs 502"), statusError(new Response(null, { status: 503 }), "GET /x")]) {
      expect(said(e)).toBe(STOPPED);
      expect(saidOnLoad(e)).toBe(STOPPED);
      expect(couldnt("save Voron", e)).toBe("Couldn't save Voron. Can't reach Conveyor. Check that it's running, then try again.");
    }
    const offline = new TypeError("Failed to fetch");
    expect(said(offline)).toBe(UNREACHABLE);
    expect(couldnt("save Voron", offline)).toBe("Couldn't save Voron. Can't reach Conveyor. Check your connection, then try again.");
  });

  test("says a page didn't load when the user did nothing", () => {
    expect(saidOnLoad(new Error("GET /api/catalog/profiles 500"))).toBe(NOT_LOADED);
    expect(saidOnLoad(new Error("database is locked"))).toBe("database is locked");
  });

  test("treats an empty message as no message", () => {
    expect(said(new Error("  "))).toBe(FAILED);
  });
});

describe("the details under a failure", () => {
  test("hold the original text whenever the page shows a plain sentence instead", () => {
    expect(detailOf(new Error("POST /jobs 500"))).toBe("POST /jobs 500");
    expect(detailOf(new Unreachable("POST /jobs 502"))).toBe("POST /jobs 502");
    expect(detailOf(new TypeError("Failed to fetch"))).toBe("Failed to fetch");
    expect(detailOf(new Error("Internal Server Error"))).toBe("Internal Server Error");
  });

  test("are empty when the server's own message is already on screen, or there is nothing to show", () => {
    expect(detailOf(new Error("database is locked"))).toBeNull();
    expect(detailOf(new Error("  "))).toBeNull();
  });
});

describe("a plain status throw", () => {
  test("is Unreachable only for 502, 503 and 504", () => {
    for (const status of [502, 503, 504]) expect(statusError(new Response(null, { status }), "GET /x")).toBeInstanceOf(Unreachable);
    const other = statusError(new Response(null, { status: 500 }), "GET /x");
    expect(other).not.toBeInstanceOf(Unreachable);
    expect(other.message).toBe("GET /x 500");
  });

  test("Print and upload behind a 502 say Conveyor isn't running, with the status in the details", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = down(502);
    try {
      const sent = await submitJob({ generator: { id: "g", params: {} }, printerId: "p", profileId: "r" }).catch((e: unknown) => e);
      const uploaded = await uploadStl(new File(["solid"], "cube.stl")).catch((e: unknown) => e);
      expect(said(sent)).toBe(STOPPED);
      expect(detailOf(sent)).toBe("POST /jobs 502");
      expect(said(uploaded)).toBe(STOPPED);
      expect(detailOf(uploaded)).toBe("POST /uploads 502");
    } finally {
      globalThis.fetch = real;
    }
  });
});
