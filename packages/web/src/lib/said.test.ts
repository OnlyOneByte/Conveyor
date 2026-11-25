import { describe, expect, test } from "bun:test";
import { couldnt, FAILED, said, serverSaid, UNREACHABLE } from "./said";

describe("what the page says about a failure", () => {
  test("keeps the server's own message", () => {
    expect(said(new Error("printer elegoo-1 is busy"))).toBe("printer elegoo-1 is busy");
    expect(couldnt("save Voron", new Error("database is locked"))).toBe(
      "Couldn't save Voron: database is locked",
    );
  });

  test("never shows a method, path and status line", () => {
    for (const line of ["GET /api/catalog/profiles 500", "POST /jobs 502", "PUT /api/catalog/printers 409", "DELETE /api/x 404"]) {
      expect(serverSaid(new Error(line))).toBeNull();
      expect(said(new Error(line))).toBe(FAILED);
      expect(couldnt("upload cube.stl", new Error(line))).toBe("Couldn't upload cube.stl. Try again.");
    }
  });

  test("reads a network failure as Conveyor being unreachable", () => {
    const down = new TypeError("Failed to fetch");
    expect(said(down)).toBe(UNREACHABLE);
    expect(couldnt("upload cube.stl", down)).toBe(
      "Couldn't upload cube.stl. Check your connection, then try again.",
    );
  });

  test("treats an empty message as no message", () => {
    expect(said(new Error("  "))).toBe(FAILED);
  });
});
