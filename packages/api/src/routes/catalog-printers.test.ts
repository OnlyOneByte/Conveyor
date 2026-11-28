import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbRecordJob, dbUpsertPrinter, openDb } from "@conveyor/shared/db";
import Fastify from "fastify";
import { registerCatalogRoutes } from "./catalog.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-catalog-printers-"));
const previousDbPath = process.env.DB_PATH;
const app = Fastify();
let base = "";

const get = (url: string) => fetch(`${base}${url}`);
const del = (url: string) => fetch(`${base}${url}`, { method: "DELETE" });
const put = (url: string, payload: unknown) =>
  fetch(`${base}${url}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

const printer = (overrides: Record<string, unknown>) => ({
  id: "catalog-printer",
  transportId: "moonraker",
  name: "Catalog Printer",
  address: "127.0.0.1:7125",
  ...overrides,
});

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

describe("printers", () => {
  test("stores a printer and lists it without its secrets", async () => {
    const res = await put("/catalog/printers", printer({ secrets: { apiKey: "hunter2" } }));
    expect(res.status).toBe(200);
    const listed = await (await get("/catalog/printers")).json();
    expect(listed).toContainEqual({
      id: "catalog-printer",
      transportId: "moonraker",
      name: "Catalog Printer",
      address: "127.0.0.1:7125",
      hasSecrets: true,
    });
    expect(JSON.stringify(listed)).not.toContain("hunter2");
  });

  test("a printer with an empty secrets object reports no secrets", async () => {
    await put("/catalog/printers", printer({ id: "no-secrets", secrets: {} }));
    const listed = await (await get("/catalog/printers")).json();
    expect(listed).toContainEqual(expect.objectContaining({ id: "no-secrets", hasSecrets: false }));
  });

  test("refuses an unknown transport with a 400 and stores nothing", async () => {
    const res = await put("/catalog/printers", printer({ id: "typo", transportId: "moonrakr" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "transportId: unknown transport",
      field: "transport",
    });
    const listed = await (await get("/catalog/printers")).json();
    expect(listed).not.toContainEqual(expect.objectContaining({ id: "typo" }));
  });

  test("refuses a printer without an address with a 400", async () => {
    const res = await put("/catalog/printers", printer({ id: "no-address", address: "" }));
    expect(res.status).toBe(400);
  });

  test("deletes a printer", async () => {
    await put("/catalog/printers", printer({ id: "doomed" }));
    expect((await del("/catalog/printers/doomed")).status).toBe(200);
    const listed = await (await get("/catalog/printers")).json();
    expect(listed).not.toContainEqual(expect.objectContaining({ id: "doomed" }));
  });

  test("lists the registered transports for the printer form", async () => {
    expect(await (await get("/catalog/transports")).json()).toEqual([
      expect.objectContaining({ id: "moonraker" }),
      expect.objectContaining({ id: "elegoo" }),
    ]);
  });
});

describe("GET /catalog/printers/:id/reachable", () => {
  async function listeningPort() {
    const server = createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
    return { port, close };
  }

  test("reports a listening printer as reachable", async () => {
    const { port, close } = await listeningPort();
    dbUpsertPrinter(openDb(), printer({ id: "online", address: `127.0.0.1:${port}` }));
    const res = await get("/catalog/printers/online/reachable");
    await close();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reachable: true, host: "127.0.0.1", port });
  });

  test("reports a closed port as unreachable with the socket error code", async () => {
    const { port, close } = await listeningPort();
    await close();
    dbUpsertPrinter(openDb(), printer({ id: "offline", address: `127.0.0.1:${port}` }));
    const res = await get("/catalog/printers/offline/reachable");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      reachable: false,
      host: "127.0.0.1",
      port,
      reason: "ECONNREFUSED",
    });
  });

  test("lists when a printer that went offline was last seen and last checked", async () => {
    const clock = spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const { port, close } = await listeningPort();
      dbUpsertPrinter(openDb(), printer({ id: "fading", address: `127.0.0.1:${port}` }));
      const fading = (times: Record<string, number>) => ({
        id: "fading",
        transportId: "moonraker",
        name: "Catalog Printer",
        address: `127.0.0.1:${port}`,
        hasSecrets: false,
        ...times,
      });
      const listed = async () => (await get("/catalog/printers")).json();
      expect(await listed()).toContainEqual(fading({}));
      await get("/catalog/printers/fading/reachable");
      await close();
      expect(await listed()).toContainEqual(fading({ lastSeenAt: 1_000, lastCheckedAt: 1_000 }));
      clock.mockReturnValue(61_000);
      expect(await (await get("/catalog/printers/fading/reachable")).json()).toMatchObject({
        reachable: false,
      });
      expect(await listed()).toContainEqual(fading({ lastSeenAt: 1_000, lastCheckedAt: 61_000 }));
    } finally {
      clock.mockRestore();
    }
  });

  test("an unknown printer is a 404", async () => {
    const res = await get("/catalog/printers/ghost/reachable");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown printer ghost" });
  });
});

describe("job history", () => {
  beforeAll(() => {
    for (let i = 0; i < 205; i++) {
      dbRecordJob(openDb(), {
        id: `history-${i}`,
        generatorId: "gridfinity",
        printerId: "klipper-garage",
        profileId: "orca/klipper-pla-0.2",
        state: "done",
      });
    }
  });

  test("returns one settled job by id", async () => {
    const res = await get("/jobs-history/history-7");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "history-7", state: "done" });
  });

  test.each(["in-flight", "never-recorded"])("a job that is %s is a 404", async (id) => {
    dbRecordJob(openDb(), {
      id: "in-flight",
      generatorId: "gridfinity",
      printerId: "klipper-garage",
      profileId: "orca/klipper-pla-0.2",
      state: "printing",
    });
    const res = await get(`/jobs-history/${id}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: `no settled job with id ${id}` });
  });

  test.each([
    ["", 50],
    ["?limit=2", 2],
    ["?limit=abc", 50],
    ["?limit=500", 200],
  ])("GET /jobs-history%s returns %p jobs", async (query, count) => {
    expect(await (await get(`/jobs-history${query}`)).json()).toHaveLength(count);
  });
});
