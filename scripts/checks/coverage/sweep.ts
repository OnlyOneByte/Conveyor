import { mock, test } from "bun:test";
import { join } from "node:path";
import { SWEEP_ENV } from "./summary";

const ROOT = join(import.meta.dir, "..", "..", "..");

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
    Redis: inert,
    Queue: inert,
    QueueEvents: inert,
    Worker: inert,
  }));
}

const files = (process.env[SWEEP_ENV] ?? "").split("\n").filter(Boolean);

test("loads every unmeasured source file so coverage can map its lines", async () => {
  for (const file of files) {
    await import(join(ROOT, file)).catch((error: unknown) => {
      console.error(`sweep could not load ${file}: ${String(error)}`);
    });
  }
});
