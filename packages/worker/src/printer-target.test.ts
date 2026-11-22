import { expect, test } from "bun:test";
import { dbUpsertPrinter, openDb } from "@conveyor/shared/db";
import { resolvePrinterTarget } from "./printer-target";

const db = openDb(":memory:");
const printer = { id: "p-secret", transportId: "moonraker", name: "P", address: "10.0.0.9" };

test("the transport target carries the decrypted secrets", () => {
  dbUpsertPrinter(db, { ...printer, secrets: { apiKey: "moonraker-key" } });
  expect(resolvePrinterTarget(db, "p-secret")).toEqual({
    id: "p-secret",
    transportId: "moonraker",
    address: "10.0.0.9",
    secrets: { apiKey: "moonraker-key" },
  });
});

test("secrets that do not decrypt fail the transport stage without leaking them", () => {
  db.exec(`UPDATE printers SET secrets_json = '{"apiKey":"plain-key"}' WHERE id = 'p-secret'`);
  expect(() => resolvePrinterTarget(db, "p-secret")).toThrow(
    "printer p-secret has stored secrets that cannot be decrypted",
  );
});

test("an unknown printer fails the transport stage", () => {
  expect(() => resolvePrinterTarget(db, "missing")).toThrow("unknown printer missing");
});
