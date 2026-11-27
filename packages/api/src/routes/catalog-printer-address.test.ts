import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbGetPrinter, dbUpsertPrinter, openDb } from "@conveyor/shared/db";
import Fastify from "fastify";
import { registerCatalogRoutes } from "./catalog.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-printer-address-"));
const previousDbPath = process.env.DB_PATH;
const previousAllow = process.env.PRINTER_ADDRESS_ALLOW;
const app = Fastify();
let base = "";

const put = (address: string, id = "addr-printer") =>
  fetch(`${base}/catalog/printers`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, transportId: "moonraker", name: "Address Printer", address }),
  });

beforeAll(async () => {
  process.env.DB_PATH = join(dir, "conveyor.db");
  delete process.env.PRINTER_ADDRESS_ALLOW;
  openDb();
  await registerCatalogRoutes(app, async () => 0);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  await app.close();
  openDb().close();
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
  if (previousAllow === undefined) delete process.env.PRINTER_ADDRESS_ALLOW;
  else process.env.PRINTER_ADDRESS_ALLOW = previousAllow;
  rmSync(dir, { recursive: true, force: true });
});

describe("saving a printer address", () => {
  test("refuses a metadata address in plain words that name the setting, and saves nothing", async () => {
    const res = await put("http://169.254.169.254/latest", "metadata-printer");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error:
        "Conveyor won't connect to 169.254.169.254: it is a link-local address, where cloud metadata services listen, not a printer on your network. If it really is your printer, add 169.254.169.254 to PRINTER_ADDRESS_ALLOW.",
      field: "address",
    });
    expect(dbGetPrinter(openDb(), "metadata-printer")).toBeUndefined();
  });

  test("keeps the LAN, loopback, path and credential forms the docs promise", async () => {
    for (const address of ["192.168.1.50:7125", "127.0.0.1:7125", "user:pass@10.0.0.9/moonraker"]) {
      expect((await put(address)).status).toBe(200);
    }
  });

  test("PRINTER_ADDRESS_ALLOW lets a refused range through", async () => {
    process.env.PRINTER_ADDRESS_ALLOW = "169.254.10.0/24";
    try {
      expect((await put("169.254.10.5", "allowed-printer")).status).toBe(200);
    } finally {
      delete process.env.PRINTER_ADDRESS_ALLOW;
    }
  });
});

test("the reachability probe refuses a saved metadata address instead of connecting", async () => {
  dbUpsertPrinter(openDb(), {
    id: "saved-metadata",
    transportId: "moonraker",
    name: "Saved before the rule",
    address: "metadata.google.internal",
  });
  const res = await fetch(`${base}/catalog/printers/saved-metadata/reachable`);
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({
    error: expect.stringContaining("Conveyor won't connect to metadata.google.internal"),
  });
});
