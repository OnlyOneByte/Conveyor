import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbUpsertPrinter, openDb } from "@conveyor/shared/db";
import Fastify, { type FastifyInstance } from "fastify";
import { registerPrinterHoldRoutes } from "./printer-holds.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-hold-"));
const dbPath = join(dir, "conveyor.db");
const previousDbPath = process.env.DB_PATH;
let app: FastifyInstance;
let base: string;

const release = (id: string, body: unknown) =>
  fetch(`${base}/catalog/printers/${id}/release`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const holdOf = (id: string) =>
  openDb().query("SELECT hold_job_id, hold_reason, hold_at FROM printers WHERE id = ?").get(id);

beforeAll(async () => {
  process.env.DB_PATH = dbPath;
  dbUpsertPrinter(openDb(), { id: "p1", transportId: "fake", name: "P1", address: "10.0.0.2" });
  app = Fastify();
  await registerPrinterHoldRoutes(app);
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

describe("POST /catalog/printers/:id/release", () => {
  test("refuses without the confirmation flag and keeps the hold", async () => {
    openDb().exec(
      "UPDATE printers SET hold_job_id = 'j1', hold_reason = 'r', hold_at = 1 WHERE id = 'p1'",
    );
    for (const body of [{}, { confirm: false }, { confirm: true, extra: 1 }]) {
      expect((await release("p1", body)).status).toBe(400);
    }
    expect(holdOf("p1")).toEqual({ hold_job_id: "j1", hold_reason: "r", hold_at: 1 });
  });

  test("clears a hold once, then answers 409, and 404 for an unknown printer", async () => {
    openDb().exec(
      "UPDATE printers SET hold_job_id = 'j1', hold_reason = 'r', hold_at = 1 WHERE id = 'p1'",
    );
    const ok = await release("p1", { confirm: true });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, printerId: "p1" });
    expect(holdOf("p1")).toEqual({ hold_job_id: null, hold_reason: null, hold_at: null });
    expect((await release("p1", { confirm: true })).status).toBe(409);
    expect((await release("nope", { confirm: true })).status).toBe(404);
  });
});
