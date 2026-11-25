import { describe, expect, test } from "bun:test";
import { elegoo } from "./index.ts";

const metadata = {
  transportId: "elegoo",
  printerId: "e1",
  ref: "a.gcode",
  address: "metadata.google.internal",
};

describe("elegoo refuses metadata addresses", () => {
  test("status refuses before opening a socket, naming the override", async () => {
    const statuses = elegoo.status(metadata)[Symbol.asyncIterator]();
    await expect(statuses.next()).rejects.toThrow(
      "Conveyor won't connect to metadata.google.internal",
    );
  });

  test("cancel refuses too", async () => {
    await expect(elegoo.cancel?.(metadata) ?? Promise.resolve()).rejects.toThrow(
      "add metadata.google.internal to PRINTER_ADDRESS_ALLOW",
    );
  });
});
