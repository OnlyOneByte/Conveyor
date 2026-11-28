import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@conveyor/shared/db";
import Fastify from "fastify";
import { stubPrinterDns } from "../../../shared/test/helpers/index.ts";
import { registerCatalogRoutes } from "./catalog.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-catalog-pin-"));
const previousDbPath = process.env.DB_PATH;
const app = Fastify();
let base = "";

beforeAll(async () => {
  process.env.DB_PATH = join(dir, "conveyor.db");
  openDb();
  await registerCatalogRoutes(app, async () => 0);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  app.server.closeAllConnections();
  await app.close();
  openDb().close();
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
  rmSync(dir, { recursive: true, force: true });
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const bound = server.address();
      if (bound && typeof bound === "object") resolve(bound.port);
      else reject(new Error(`unexpected server address ${String(bound)}`));
    });
  });
}

test("the reachability check connects to the IP the guard checked, not to the name again", async () => {
  const server = createServer((socket) => socket.end());
  const port = await listen(server);
  const dns = stubPrinterDns(["127.0.0.1"]);
  try {
    const address = `printer.invalid:${port}`;
    const saved = await fetch(`${base}/catalog/printers`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "pin", transportId: "moonraker", name: "Pin", address }),
    });
    expect(saved.status).toBe(200);
    const reached = await (await fetch(`${base}/catalog/printers/pin/reachable`)).json();
    expect(reached).toMatchObject({ reachable: true, host: "printer.invalid", port });
    expect(dns.asked).toEqual(["printer.invalid", "printer.invalid"]);
  } finally {
    dns.restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
