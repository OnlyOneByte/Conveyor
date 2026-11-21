import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { dbUpsertProfile, openDb } from "@conveyor/shared/db";
import Fastify from "fastify";
import { registerCatalogRoutes } from "./catalog";

const previousDbPath = process.env.DB_PATH;
process.env.DB_PATH = ":memory:";

const app = Fastify();
let base = "";

const put = (url: string, payload: unknown) =>
  fetch(`${base}${url}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

const profile = (overrides: Record<string, string>) => ({
  id: "api-test",
  slicerId: "prusa",
  name: "Profile",
  path: "/profiles/prusa-klipper-pla-0.2",
  gcodeFlavor: "klipper",
  ...overrides,
});

beforeAll(async () => {
  await registerCatalogRoutes(app);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  await app.close();
  process.env.DB_PATH = previousDbPath;
});

describe("PUT /catalog/profiles", () => {
  test("accepts a bundled path and a registered slicer", async () => {
    const res = await put("/catalog/profiles", profile({}));
    expect(res.status).toBe(200);
  });

  test.each(["/profiles/../etc", "/etc", "/profiles/a/b", "/data/conveyor", "profiles/x"])(
    "rejects path %p",
    async (path) => {
      const res = await put("/catalog/profiles", profile({ id: "bad-path", path }));
      expect(res.status).toBe(400);
    },
  );

  test("rejects an unregistered slicer", async () => {
    const res = await put("/catalog/profiles", profile({ id: "bad-slicer", slicerId: "nope" }));
    expect(res.status).toBe(400);
  });
});

describe("PUT /catalog/profiles/:id/content", () => {
  test.each(["post_process", "output_filename_format", "printhost_apikey"])(
    "rejects a Prusa config with %p",
    async (key) => {
      dbUpsertProfile(openDb(), profile({ id: "content-prusa" }));
      const res = await put("/catalog/profiles/content-prusa/content", {
        format: "prusa-ini",
        document: { config: `layer_height = 0.2\n${key} = x\n` },
      });
      expect(res.status).toBe(400);
    },
  );

  test.each(["post_process", "filename_format", "slicing_pipeline_plugin"])(
    "rejects an Orca document with %p",
    async (key) => {
      dbUpsertProfile(
        openDb(),
        profile({ id: "content-orca", slicerId: "orca", path: "/profiles/orca-klipper-pla-0.2" }),
      );
      const res = await put("/catalog/profiles/content-orca/content", {
        format: "orca-json",
        documents: {
          machine: '{"type":"machine"}',
          process: JSON.stringify({ type: "process", [key]: ["x"] }),
          filament: '{"type":"filament"}',
        },
      });
      expect(res.status).toBe(400);
    },
  );
});
