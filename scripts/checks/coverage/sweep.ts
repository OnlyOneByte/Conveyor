import { mock, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SWEEP_ENV, SWEEP_REPORT_ENV, sweepTimeoutMs } from "./summary";

const ROOT = join(import.meta.dir, "..", "..", "..");

const timeoutMs = sweepTimeoutMs(process.env);

if (timeoutMs instanceof Error) throw timeoutMs;

function target() {
  return undefined;
}

const inert: object = new Proxy(target, {
  get: (_target, key) => (key === "then" ? undefined : inert),
  apply: () => inert,
  construct: () => inert,
});

const SIDE_EFFECT_MODULES = [
  "fastify",
  "@fastify/multipart",
  "@fastify/websocket",
  "bullmq",
  "ioredis",
];

for (const name of SIDE_EFFECT_MODULES) {
  mock.module(name, () => ({
    default: inert,
    DelayedError: inert,
    Redis: inert,
    Queue: inert,
    QueueEvents: inert,
    Worker: inert,
  }));
}

const BUILD_TIME_MODULES: Record<string, Record<string, unknown>> = {
  "$app/env": { version: "sweep" },
  "$app/manifest": { assets: [], immutable: [] },
  "virtual:editor-chunks": { default: [] },
};

for (const [name, exports] of Object.entries(BUILD_TIME_MODULES)) {
  mock.module(name, () => exports);
}

const files = (process.env[SWEEP_ENV] ?? "").split("\n").filter(Boolean);

class ExitDuringImport extends Error {}

process.exit = (code?: number | string | null) => {
  throw new ExitDuringImport(`process.exit(${String(code)}) during import`);
};

test(
  "loads every source file so coverage can map its lines",
  async () => {
    const failed: string[] = [];
    for (const file of files) {
      await import(resolve(ROOT, file)).catch((error: unknown) => {
        console.error(`sweep could not load ${file}: ${String(error)}`);
        failed.push(file);
      });
    }
    const report = process.env[SWEEP_REPORT_ENV];
    if (report) writeFileSync(report, JSON.stringify({ completed: true, failed }));
  },
  timeoutMs,
);
