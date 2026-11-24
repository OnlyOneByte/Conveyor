import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@conveyor/shared/db";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { registerCatalogRoutes } from "./catalog.js";
import { countLiveJobs, registerJobRoutes } from "./jobs-sqlite.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-corrupt-printer-"));
const previousDbPath = process.env.DB_PATH;
let db: Database;
let app: FastifyInstance;

beforeAll(async () => {
  process.env.DB_PATH = join(dir, "conveyor.db");
  db = openDb(process.env.DB_PATH);
  db.query(
    `INSERT INTO printers (id, transport_id, name, address, allowed_generators_json, created_at)
     VALUES ('broken', 'moonraker', 'Broken', '10.0.0.10', '["gridfinity"', 0)`,
  ).run();
  app = Fastify();
  await app.register(websocket);
  await registerCatalogRoutes(app, countLiveJobs);
  await registerJobRoutes(app, db);
});

afterAll(async () => {
  await app.close();
  db.close();
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
  rmSync(dir, { recursive: true, force: true });
});

const submit = (printerId: string) =>
  app.inject({
    method: "POST",
    url: "/jobs",
    payload: {
      generator: { id: "gridfinity", params: {} },
      printerId,
      profileId: "orca/klipper-pla-0.2",
    },
  });

describe("one printer with an unreadable generator list", () => {
  test("still lists every printer, marking the broken one", async () => {
    const res = await app.inject({ method: "GET", url: "/catalog/printers" });
    expect(res.statusCode).toBe(200);
    const byId = new Map(res.json<{ id: string }[]>().map((p) => [p.id, p]));
    expect(byId.get("broken")).toMatchObject({
      allowedGenerators: [],
      unreadable: ["allowedGenerators"],
    });
    expect(byId.get("klipper-garage")).not.toHaveProperty("unreadable");
  });

  test("doesn't stop jobs going to the other printers", async () => {
    const res = await submit("klipper-garage");
    expect(res.statusCode).toBe(202);
  });

  test("takes no jobs itself until it is saved again", async () => {
    const res = await submit("broken");
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toContain("gridfinity");
  });
});
