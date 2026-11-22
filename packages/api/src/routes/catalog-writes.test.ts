import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { MAX_SECRET_VALUE_LENGTH, MAX_SECRETS } from "../catalog-validation";
import { registerCatalogRoutes } from "./catalog";

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
  await registerCatalogRoutes(app);
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

  test.each([
    [
      "an unknown gcode flavor",
      profile({ id: "bad-flavor", gcodeFlavor: "reprap" }),
      "gcodeFlavor: unknown gcode flavor",
    ],
    ["a missing name", profile({ id: "no-name", name: undefined }), "name: Required"],
    ["a body that is not an object", "profile", "body: Expected object, received string"],
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
    ],
    [
      "too many secrets",
      printer({ secrets: manySecrets }),
      `secrets: at most ${MAX_SECRETS} secrets`,
    ],
    [
      "an oversized secret",
      printer({ secrets: { apiKey: "k".repeat(MAX_SECRET_VALUE_LENGTH + 1) } }),
      `secrets.apiKey: String must contain at most ${MAX_SECRET_VALUE_LENGTH} character(s)`,
    ],
    [
      "an oversized secret name",
      printer({ secrets: { ["k".repeat(65)]: "v" } }),
      `secrets.${"k".repeat(65)}: String must contain at most 64 character(s)`,
    ],
    [
      "an unknown transport",
      printer({ id: "typo-transport", transportId: "octoprint" }),
      "transportId: unknown transport",
    ],
  ])("refuses %s with a 400 naming the field", async (_label, body, error) => {
    expect(await put("/catalog/printers", body)).toEqual({ status: 400, body: { error } });
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
      body: { error: "documents.process: Required; documents.filament: Required" },
    });
  });
});
