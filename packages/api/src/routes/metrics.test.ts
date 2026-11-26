import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbRecordJob, dbWriteWorkerHeartbeat, openDb } from "@conveyor/shared/db";
import Fastify from "fastify";
import { METRICS_CONTENT_TYPE, registerMetricsRoutes } from "./metrics.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-metrics-"));
const db = openDb(join(dir, "conveyor.db"));
const NOW = 1_800_000_000_000;
let live: () => Promise<Record<string, number>> = async () => ({ waiting: 2, active: 1 });
const app = Fastify();
let base = "";

beforeAll(async () => {
  const job = (id: string, extra: Partial<Parameters<typeof dbRecordJob>[1]>) =>
    dbRecordJob(db, {
      id,
      generatorId: "gridfinity",
      params: { gridX: 4, label: "secret-bin-label" },
      printerId: "klipper-garage",
      profileId: "orca/klipper-pla-0.2",
      state: "done",
      ...extra,
    });
  job("done-1", {
    timings: [
      { stage: "generator", enteredAt: 0, durationMs: 2000 },
      { stage: "slicer", enteredAt: 2000, durationMs: 40_000 },
    ],
  });
  job("failed-1", {
    state: "failed",
    stage: "slicer",
    error: { stage: "slicer", reason: "prusa-slicer exited 1: /data/secret/model.stl" },
  });
  job("canceled-1", { state: "canceled" });
  dbWriteWorkerHeartbeat(db, "worker-alpha", { at: NOW - 1000, engines: {} });
  dbWriteWorkerHeartbeat(db, "worker-beta", { at: NOW - 600_000, engines: {} });
  registerMetricsRoutes(
    app,
    () => live(),
    () => db,
    () => NOW,
  );
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("GET /metrics serves counts, live jobs, fresh workers and stage timings", async () => {
  const res = await fetch(`${base}/metrics`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe(METRICS_CONTENT_TYPE);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const lines = (await res.text()).split("\n");
  expect(lines).toContain('conveyor_jobs_finished_total{state="done"} 1');
  expect(lines).toContain('conveyor_jobs_finished_total{state="failed"} 1');
  expect(lines).toContain('conveyor_jobs_finished_total{state="canceled"} 1');
  expect(lines).toContain('conveyor_job_failures_total{stage="slicer"} 1');
  expect(lines).toContain('conveyor_jobs_live{state="waiting"} 2');
  expect(lines).toContain('conveyor_jobs_live{state="active"} 1');
  expect(lines).toContain("conveyor_workers_up 1");
  expect(lines).toContain('conveyor_stage_duration_seconds_count{stage="slicer"} 1');
  expect(lines).toContain('conveyor_stage_duration_seconds_sum{stage="slicer"} 40');
});

test("GET /metrics carries no job content: ids, params, printers, paths or reasons", async () => {
  const text = await (await fetch(`${base}/metrics`)).text();
  for (const secret of [
    "done-1",
    "secret-bin-label",
    "klipper-garage",
    "gridfinity",
    "orca/klipper-pla-0.2",
    "/data/secret",
    "prusa-slicer exited",
    "worker-alpha",
    "worker-beta",
  ])
    expect(text).not.toContain(secret);
});

test("GET /metrics answers 503 when the job queue can't be counted", async () => {
  live = async () => {
    throw new Error("redis down");
  };
  const res = await fetch(`${base}/metrics`);
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "the job queue is unreachable" });
  live = async () => ({});
});
