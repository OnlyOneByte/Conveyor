import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbRecordJob, openDb } from "@conveyor/shared/db";
import Fastify from "fastify";
import { registerCatalogRoutes } from "./catalog.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-files-removed-"));
const saved = {
  DB_PATH: process.env.DB_PATH,
  DATA_DIR: process.env.DATA_DIR,
  CONVEYOR_RETENTION_DAYS: process.env.CONVEYOR_RETENTION_DAYS,
};
const app = Fastify();
let base = "";
const DAY = 24 * 60 * 60 * 1000;

function job(ageDays: number, withFolder: boolean): string {
  const id = crypto.randomUUID();
  dbRecordJob(openDb(), {
    id,
    generatorId: "gridfinity",
    params: {},
    printerId: "p",
    profileId: "q",
    state: "done",
    modelPath: join(dir, id, "model.stl"),
    gcodePath: join(dir, id, "model.gcode"),
  });
  openDb()
    .query("UPDATE jobs SET updated_at = ? WHERE id = ?")
    .run(Date.now() - ageDays * DAY, id);
  if (withFolder) mkdirSync(join(dir, id));
  return id;
}

const entry = async (id: string): Promise<unknown> =>
  (await fetch(`${base}/jobs-history/${id}`)).json();
const removedAfter = async (id: string, days: number) =>
  expect(await entry(id)).toMatchObject({ id, filesRemovedAfterDays: days });
const keepsFiles = async (id: string) =>
  expect(await entry(id)).not.toHaveProperty("filesRemovedAfterDays");

beforeAll(async () => {
  process.env.DB_PATH = join(dir, "conveyor.db");
  process.env.DATA_DIR = dir;
  delete process.env.CONVEYOR_RETENTION_DAYS;
  openDb();
  await registerCatalogRoutes(app, async () => 0);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  await app.close();
  openDb().close();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

test("a job past the retention age whose folder is gone says its files were removed", async () => {
  await removedAfter(job(31, false), 30);
});

test("a folder still on disk, a recent job, or retention turned off say nothing", async () => {
  await keepsFiles(job(31, true));
  await keepsFiles(job(29, false));
  process.env.CONVEYOR_RETENTION_DAYS = "0";
  try {
    await keepsFiles(job(400, false));
  } finally {
    delete process.env.CONVEYOR_RETENTION_DAYS;
  }
});

test("the note uses the configured number of days", async () => {
  process.env.CONVEYOR_RETENTION_DAYS = "45";
  try {
    await removedAfter(job(46, false), 45);
    await keepsFiles(job(44, false));
  } finally {
    delete process.env.CONVEYOR_RETENTION_DAYS;
  }
});

test("a job whose folder holds an engine.log lists it as an artifact, and others don't", async () => {
  const logged = job(1, true);
  writeFileSync(join(dir, logged, "engine.log"), "$ prusa-slicer\n");
  expect(await entry(logged)).toMatchObject({
    artifacts: { log: join(dir, logged, "engine.log") },
  });
  const quiet = job(1, true);
  expect(await entry(quiet)).not.toHaveProperty("artifacts.log");
});
