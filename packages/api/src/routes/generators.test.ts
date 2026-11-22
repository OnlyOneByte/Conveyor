import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { gridfinity } from "@conveyor/generator-gridfinity";
import { passthrough } from "@conveyor/generator-passthrough";
import Fastify from "fastify";
import { z } from "zod";
import { registerGeneratorRoutes } from "./generators.js";

const app = Fastify();
let base = "";

beforeAll(async () => {
  await registerGeneratorRoutes(app);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  await app.close();
});

describe("GET /generators", () => {
  test("lists every registered generator's UI metadata", async () => {
    const res = await fetch(`${base}/generators`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      JSON.parse(
        JSON.stringify({
          id: gridfinity.id,
          name: gridfinity.name,
          paramSchema: gridfinity.paramSchema,
          ui: gridfinity.ui,
          preview: gridfinity.preview,
          outputs: gridfinity.outputs,
        }),
      ),
      expect.objectContaining({ id: passthrough.id, outputs: passthrough.outputs }),
    ]);
  });

  test("sends only the metadata keys, never the plugin's code or version", async () => {
    const body = z
      .array(z.record(z.unknown()))
      .parse(await (await fetch(`${base}/generators`)).json());
    const allowed = ["id", "name", "paramSchema", "ui", "preview", "outputs"];
    for (const generator of body) {
      expect(Object.keys(generator).filter((k) => !allowed.includes(k))).toEqual([]);
    }
  });
});
