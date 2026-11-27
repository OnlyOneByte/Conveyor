import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { MAX_SECRET_VALUE_LENGTH, MAX_SECRETS } from "../catalog-validation";
import { registerCatalogRoutes } from "./catalog";
import { countLiveJobs as countSqliteLiveJobs } from "./jobs-sqlite";

const dir = mkdtempSync(join(tmpdir(), "conveyor-catalog-writes-"));
const previousDbPath = process.env.DB_PATH;
process.env.DB_PATH = join(dir, "conveyor.db");

const app = Fastify();
let base = "";

const put = async (url: string, payload: unknown) => {
  const res = await fetch(`${base}${url}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as { error?: unknown } };
};
const list = async (url: string) => (await (await fetch(`${base}${url}`)).json()) as unknown[];

const profile = (overrides: Record<string, unknown>) => ({
  id: "writes-profile",
  slicerId: "prusa",
  name: "Profile",
  path: "/profiles/prusa-marlin-pla-0.2",
  gcodeFlavor: "marlin",
  ...overrides,
});
const printer = (overrides: Record<string, unknown>) => ({
  id: "writes-printer",
  transportId: "moonraker",
  name: "Printer",
  address: "10.0.0.9:7125",
  ...overrides,
});

beforeAll(async () => {
  await registerCatalogRoutes(app, countSqliteLiveJobs);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  await app.close();
  process.env.DB_PATH = previousDbPath;
  rmSync(dir, { recursive: true, force: true });
});

describe("PUT /catalog/profiles", () => {
  test("stores a profile with a known gcode flavor", async () => {
    expect((await put("/catalog/profiles", profile({}))).status).toBe(200);
    expect(await list("/catalog/profiles")).toContainEqual(
      expect.objectContaining({ id: "writes-profile", gcodeFlavor: "marlin" }),
    );
  });

  test("refuses renaming a bundled profile or changing its firmware, slicer or folder", async () => {
    const shipped = {
      id: "prusa/marlin-pla-0.2",
      slicerId: "prusa",
      name: "Marlin PLA 0.2mm (Prusa)",
      path: "/profiles/prusa-marlin-pla-0.2",
      gcodeFlavor: "marlin",
    };
    for (const change of [
      { name: "Renamed" },
      { gcodeFlavor: "klipper" },
      { slicerId: "orca" },
      { path: "/profiles/elsewhere" },
    ]) {
      const res = await put("/catalog/profiles", { ...shipped, ...change });
      expect(res.status).toBe(409);
      expect(String(res.body.error)).toContain("is bundled");
    }
    expect((await put("/catalog/profiles", shipped)).status).toBe(200);
    expect(await list("/catalog/profiles")).toContainEqual({
      ...shipped,
      bundled: true,
      volume: { x: 220, y: 220, z: 250 },
    });
  });

  test("lists each profile with whether it is bundled, and the slicers by name", async () => {
    await put("/catalog/profiles", profile({ id: "added-one" }));
    expect(await list("/catalog/profiles")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "prusa/marlin-pla-0.2", bundled: true }),
        expect.objectContaining({ id: "added-one", bundled: false }),
      ]),
    );
    expect(await list("/catalog/slicers")).toEqual(
      expect.arrayContaining([
        { id: "orca", name: "OrcaSlicer" },
        { id: "prusa", name: "PrusaSlicer" },
      ]),
    );
  });

  test.each([
    [
      "an unknown gcode flavor",
      profile({ id: "bad-flavor", gcodeFlavor: "reprap" }),
      "gcodeFlavor: unknown gcode flavor",
    ],
    [
      "a missing name",
      profile({ id: "no-name", name: undefined }),
      "name: Invalid input: expected string, received undefined",
    ],
    [
      "a body that is not an object",
      "profile",
      "body: Invalid input: expected object, received string",
    ],
  ])("refuses %s with a 400 naming the field", async (_label, body, error) => {
    expect(await put("/catalog/profiles", body)).toEqual({ status: 400, body: { error } });
  });
});

describe("PUT /catalog/printers", () => {
  test("stores a printer with registered generators and bounded secrets", async () => {
    const body = printer({
      allowedGenerators: ["gridfinity"],
      secrets: { apiKey: "k".repeat(MAX_SECRET_VALUE_LENGTH) },
    });
    expect((await put("/catalog/printers", body)).status).toBe(200);
    expect(await list("/catalog/printers")).toContainEqual(
      expect.objectContaining({
        id: "writes-printer",
        allowedGenerators: ["gridfinity"],
        hasSecrets: true,
      }),
    );
  });

  test(`accepts exactly ${MAX_SECRETS} secrets`, async () => {
    const secrets = Object.fromEntries(
      Array.from({ length: MAX_SECRETS }, (_, i) => [`key${i}`, "v"]),
    );
    expect((await put("/catalog/printers", printer({ id: "sixteen-keys", secrets }))).status).toBe(
      200,
    );
  });

  const manySecrets = Object.fromEntries(
    Array.from({ length: MAX_SECRETS + 1 }, (_, i) => [`key${i}`, "v"]),
  );

  test.each([
    [
      "an unregistered generator",
      printer({ allowedGenerators: ["gridfinity", "laser"] }),
      "allowedGenerators.1: unknown generator",
      undefined,
    ],
    [
      "too many secrets",
      printer({ secrets: manySecrets }),
      `secrets: at most ${MAX_SECRETS} secrets`,
      "secrets",
    ],
    [
      "an oversized secret",
      printer({ secrets: { apiKey: "k".repeat(MAX_SECRET_VALUE_LENGTH + 1) } }),
      `secrets.apiKey: Too big: expected string to have <=${MAX_SECRET_VALUE_LENGTH} characters`,
      "secrets",
    ],
    [
      "an oversized secret name",
      printer({ secrets: { ["k".repeat(65)]: "v" } }),
      `secrets.${"k".repeat(65)}: Too big: expected string to have <=64 characters`,
      "secrets",
    ],
    [
      "an unknown transport",
      printer({ id: "typo-transport", transportId: "octoprint" }),
      "transportId: unknown transport",
      "transport",
    ],
    [
      "an empty name",
      printer({ name: "" }),
      "name: Too small: expected string to have >=1 characters",
      "name",
    ],
    [
      "an empty id",
      printer({ id: "" }),
      "id: Too small: expected string to have >=1 characters",
      "id",
    ],
    [
      "an empty address",
      printer({ address: "" }),
      "address: Too small: expected string to have >=1 characters",
      "address",
    ],
    [
      "an empty name and an empty address, naming the first",
      printer({ name: "", address: "" }),
      "name: Too small: expected string to have >=1 characters; address: Too small: expected string to have >=1 characters",
      "name",
    ],
    [
      "an empty address and an oversized secret, naming the first",
      printer({ address: "", secrets: { apiKey: "k".repeat(MAX_SECRET_VALUE_LENGTH + 1) } }),
      `address: Too small: expected string to have >=1 characters; secrets.apiKey: Too big: expected string to have <=${MAX_SECRET_VALUE_LENGTH} characters`,
      "address",
    ],
  ])("refuses %s with a 400 naming the field", async (_label, body, error, field) => {
    const expected = field ? { error, field } : { error };
    expect(await put("/catalog/printers", body)).toEqual({ status: 400, body: expected });
  });
});

describe("PUT /catalog/profiles/:id/content", () => {
  test("names every missing Orca document", async () => {
    const res = await put("/catalog/profiles/orca%2Fklipper-pla-0.2/content", {
      format: "orca-json",
      documents: { machine: "{}" },
    });
    expect(res).toEqual({
      status: 400,
      body: {
        error:
          "documents.process: Invalid input: expected string, received undefined; documents.filament: Invalid input: expected string, received undefined",
      },
    });
  });
});
