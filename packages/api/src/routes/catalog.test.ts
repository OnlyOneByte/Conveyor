import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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

const get = (url: string) => fetch(`${base}${url}`);
const del = (url: string) => fetch(`${base}${url}`, { method: "DELETE" });

const bundled = (file: string) =>
  readFileSync(new URL(`../../../../profiles/${file}`, import.meta.url), "utf8");

const orcaDocuments = () => ({
  machine: bundled("orca-klipper-pla-0.2/machine.json"),
  process: bundled("orca-klipper-pla-0.2/process.json"),
  filament: bundled("orca-klipper-pla-0.2/filament.json"),
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

describe("profile content lifecycle", () => {
  beforeAll(() => {
    dbUpsertProfile(
      openDb(),
      profile({ id: "life-orca", slicerId: "orca", path: "/profiles/orca-klipper-pla-0.2" }),
    );
    dbUpsertProfile(openDb(), profile({ id: "life-prusa" }));
  });

  test("an unedited Orca profile serves its three bundled documents", async () => {
    const res = await get("/catalog/profiles/life-orca/content");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      format: "orca-json",
      source: "bundled",
      documents: orcaDocuments(),
    });
  });

  test("an Orca edit is stored verbatim, served as edited, then reset to bundled", async () => {
    const documents = { ...orcaDocuments(), machine: `${orcaDocuments().machine}\n` };
    const saved = await put("/catalog/profiles/life-orca/content", {
      format: "orca-json",
      documents,
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ ok: true, source: "edited" });
    const edited = await (await get("/catalog/profiles/life-orca/content")).json();
    expect(edited).toEqual({ format: "orca-json", source: "edited", documents });

    const reset = await del("/catalog/profiles/life-orca/content");
    expect(await reset.json()).toEqual({ ok: true, source: "bundled" });
    expect(await (await get("/catalog/profiles/life-orca/content")).json()).toMatchObject({
      source: "bundled",
    });
  });

  test("an unedited Prusa profile serves its bundled config.ini", async () => {
    const res = await get("/catalog/profiles/life-prusa/content");
    expect(await res.json()).toEqual({
      format: "prusa-ini",
      source: "bundled",
      document: { config: bundled("prusa-klipper-pla-0.2/config.ini") },
    });
  });

  test("a Prusa edit is stored, served as edited, then reset to bundled", async () => {
    const document = { config: "layer_height = 0.3\n" };
    const saved = await put("/catalog/profiles/life-prusa/content", {
      format: "prusa-ini",
      document,
    });
    expect(saved.status).toBe(200);
    expect(await (await get("/catalog/profiles/life-prusa/content")).json()).toEqual({
      format: "prusa-ini",
      source: "edited",
      document,
    });
    expect((await del("/catalog/profiles/life-prusa/content")).status).toBe(200);
    expect(await (await get("/catalog/profiles/life-prusa/content")).json()).toMatchObject({
      source: "bundled",
    });
  });

  test.each([
    ["life-orca", { format: "prusa-ini", document: { config: "x = 1\n" } }],
    ["life-prusa", { format: "prusa-ini", document: { config: "x = 1\n" }, extra: true }],
  ])("a body of the wrong shape for %p is a 400", async (id, body) => {
    expect((await put(`/catalog/profiles/${id}/content`, body)).status).toBe(400);
  });

  test("a slicer with no editable format is a 409 on every verb", async () => {
    dbUpsertProfile(openDb(), profile({ id: "life-cura", slicerId: "cura" }));
    const body = { format: "prusa-ini", document: { config: "" } };
    for (const res of [
      await get("/catalog/profiles/life-cura/content"),
      await put("/catalog/profiles/life-cura/content", body),
      await del("/catalog/profiles/life-cura/content"),
    ]) {
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "raw editing is not supported for cura profiles" });
    }
  });

  test("an unknown profile is a 404 on every verb", async () => {
    for (const res of [
      await get("/catalog/profiles/ghost/content"),
      await put("/catalog/profiles/ghost/content", {}),
      await del("/catalog/profiles/ghost/content"),
    ]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "unknown profile ghost" });
    }
  });

  test("a bundle directory that does not exist is a 404", async () => {
    dbUpsertProfile(
      openDb(),
      profile({ id: "life-missing", slicerId: "orca", path: "/profiles/not-shipped" }),
    );
    const res = await get("/catalog/profiles/life-missing/content");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "bundled profile directory is unavailable" });
    expect((await del("/catalog/profiles/life-missing/content")).status).toBe(404);
  });

  test("a profile whose path is outside /profiles is a 409", async () => {
    dbUpsertProfile(openDb(), profile({ id: "life-outside", path: "/etc/conveyor" }));
    const res = await get("/catalog/profiles/life-outside/content");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "profile does not reference a bundled /profiles path",
    });
  });

  test("deletes a profile", async () => {
    dbUpsertProfile(openDb(), profile({ id: "life-doomed" }));
    expect((await del("/catalog/profiles/life-doomed")).status).toBe(200);
    const listed = await (await get("/catalog/profiles")).json();
    expect(listed).not.toContainEqual(expect.objectContaining({ id: "life-doomed" }));
  });
});
