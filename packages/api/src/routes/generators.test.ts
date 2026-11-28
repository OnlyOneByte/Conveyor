import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Fastify from "fastify";
import { z } from "zod";
import { apiRegistry } from "../registry.js";
import { registerGeneratorRoutes } from "./generators.js";

const app = Fastify();
let base = "";

beforeAll(async () => {
  await registerGeneratorRoutes(app);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  app.server.closeAllConnections();
  await app.close();
});

describe("GET /generators", () => {
  test("lists every registered generator's UI metadata", async () => {
    const res = await fetch(`${base}/generators`);
    expect(res.status).toBe(200);
    const expected = [...apiRegistry.generators.values()].map((g) =>
      JSON.parse(
        JSON.stringify({
          id: g.id,
          name: g.name,
          paramSchema: g.paramSchema,
          ui: g.ui,
          preview: g.preview,
          outputs: g.outputs,
        }),
      ),
    );
    expect(await res.json()).toEqual(expected);
    expect(expected.map((g) => g.id)).toEqual(["gridfinity", "passthrough"]);
  });

  test("sends only the metadata keys, never the plugin's code or version", async () => {
    const body = z
      .array(z.record(z.string(), z.unknown()))
      .parse(await (await fetch(`${base}/generators`)).json());
    const allowed = ["id", "name", "paramSchema", "ui", "preview", "outputs"];
    for (const generator of body) {
      expect(Object.keys(generator).filter((k) => !allowed.includes(k))).toEqual([]);
    }
  });
});
