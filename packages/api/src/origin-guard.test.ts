import { afterEach, describe, expect, test } from "bun:test";
import Fastify, { type FastifyInstance } from "fastify";
import { CROSS_ORIGIN_REFUSED, registerOriginGuard } from "./origin";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function guarded(): Promise<FastifyInstance> {
  app = Fastify();
  registerOriginGuard(app);
  app.post("/write", async () => ({ ok: true }));
  app.get("/read", async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe("registerOriginGuard", () => {
  test("answers a cross-origin write with 403 before the route runs", async () => {
    const res = await (await guarded()).inject({
      method: "POST",
      url: "/write",
      headers: { host: "conveyor.example", origin: "https://evil.example" },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: CROSS_ORIGIN_REFUSED });
    expect(res.headers.connection).not.toBe("close");
  });

  test("closes the connection after refusing an upload body", async () => {
    const res = await (await guarded()).inject({
      method: "POST",
      url: "/write",
      headers: {
        host: "conveyor.example",
        origin: "https://evil.example",
        "content-type": "multipart/form-data; boundary=B",
      },
      payload: "--B--\r\n",
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers.connection).toBe("close");
  });

  test("lets a same-origin write and a cross-origin read reach their routes", async () => {
    const api = await guarded();
    const write = await api.inject({
      method: "POST",
      url: "/write",
      headers: { host: "conveyor.example", origin: "https://conveyor.example" },
    });
    const read = await api.inject({
      method: "GET",
      url: "/read",
      headers: { host: "conveyor.example", origin: "https://evil.example" },
    });
    expect([write.statusCode, read.statusCode]).toEqual([200, 200]);
  });
});
