import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbUpsertProfile, openDb } from "@conveyor/shared/db";
import Fastify from "fastify";
import { registerCatalogRoutes } from "./catalog";
import { countLiveJobs as countSqliteLiveJobs } from "./jobs-sqlite";

const previousDbPath = process.env.DB_PATH;
const dir = mkdtempSync(join(tmpdir(), "conveyor-catalog-volume-"));
const app = Fastify();
let base = "";

beforeAll(async () => {
  process.env.DB_PATH = join(dir, "conveyor.db");
  await registerCatalogRoutes(app, countSqliteLiveJobs);
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

test("one profile whose volume can't be read is listed without one, and the rest keep theirs", async () => {
  dbUpsertProfile(openDb(), {
    id: "broken-path",
    slicerId: "prusa",
    name: "Broken",
    path: "/etc/conveyor",
    gcodeFlavor: "klipper",
  });
  const res = await fetch(`${base}/catalog/profiles`);
  expect(res.status).toBe(200);
  const listed: unknown = await res.json();
  const rows = Array.isArray(listed) ? listed : [];
  const broken = rows.find((p) => p.id === "broken-path");
  expect(broken).toBeDefined();
  expect("volume" in broken).toBe(false);
  expect(rows.find((p) => p.id === "orca/klipper-pla-0.2")?.volume).toEqual({
    x: 220,
    y: 220,
    z: 250,
  });
});
