import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Fastify from "fastify";
import { registerErrorReplies } from "./error-replies";
import { QueueUnavailableError } from "./queue-reach";

const app = Fastify();

beforeAll(async () => {
  registerErrorReplies(app);
  app.get("/deadline", async () => {
    throw new QueueUnavailableError("queue gave no answer within 2000 ms");
  });
  app.get("/ioredis", async () => {
    throw new Error("Stream isn't writeable and enableOfflineQueue options is false");
  });
  app.get("/bug", async () => {
    throw new Error("secret detail at /data/conveyor.db");
  });
  app.post(
    "/typed",
    {
      schema: { body: { type: "object", required: ["n"], properties: { n: { type: "number" } } } },
    },
    async () => ({ ok: true }),
  );
  await app.ready();
});

afterAll(() => app.close());

describe("error replies", () => {
  test("a queue that can't be reached is a 503 with a plain message", async () => {
    for (const url of ["/deadline", "/ioredis"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(503);
      expect(res.json<{ error: string }>()).toEqual({ error: "queue unavailable" });
    }
  });

  test("any other failure is a 500 that doesn't leak the error's text", async () => {
    const res = await app.inject({ method: "GET", url: "/bug" });
    expect(res.statusCode).toBe(500);
    expect(res.json<{ error: string }>()).toEqual({ error: "internal error" });
    expect(res.body).not.toContain("secret detail");
  });

  test("a client error keeps Fastify's own status and message", async () => {
    const res = await app.inject({ method: "POST", url: "/typed", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json<Record<string, unknown>>()).toMatchObject({
      statusCode: 400,
      message: "body must have required property 'n'",
    });
  });
});
