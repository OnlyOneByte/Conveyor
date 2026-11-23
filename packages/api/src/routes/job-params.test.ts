import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@conveyor/shared/db";
import Fastify, { type FastifyInstance } from "fastify";
import { parseGeneratorParams } from "../validate.js";
import { parseSubmission } from "./job-common.js";
import { registerJobRoutes } from "./jobs-sqlite.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-job-params-"));
const previous = { DB_PATH: process.env.DB_PATH, UPLOAD_DIR: process.env.UPLOAD_DIR };
const job = (id: string, params: unknown) => ({
  generator: { id, params },
  printerId: "klipper-garage",
  profileId: "orca/klipper-pla-0.2",
});
let app: FastifyInstance;
let base = "";

beforeAll(async () => {
  process.env.DB_PATH = join(dir, "conveyor.db");
  process.env.UPLOAD_DIR = dir;
  writeFileSync(join(dir, "good.stl"), "solid cube\nendsolid cube\n");
  writeFileSync(join(dir, "junk.stl"), "not a model");
  app = Fastify();
  await registerJobRoutes(app, openDb(process.env.DB_PATH));
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  await app.close();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

const rejection = (body: unknown) => {
  const result = parseSubmission(body);
  return result.ok ? "accepted" : `${result.code} ${String(result.error)}`;
};

describe("parseSubmission generator params", () => {
  test("applies the generator's defaults on the happy path", () => {
    const result = parseSubmission(job("gridfinity", { gridX: 4 }));
    expect(result.ok && result.request.generator.params).toEqual({
      gridX: 4,
      gridY: 3,
      heightUnits: 6,
      divisionsX: 1,
      divisionsY: 1,
      scoop: false,
      labelTab: false,
      magnetHoles: false,
      stackingLip: true,
    });
  });

  test.each([
    ["an unknown key", { gridX: 2, colour: "red" }, "generator.params.colour: unknown field"],
    [
      "a wrong type",
      { gridX: "2" },
      "generator.params.gridX: Invalid input: expected number, received string",
    ],
    [
      "an out-of-range value",
      { gridX: 21 },
      "generator.params.gridX: Too big: expected number to be <=20",
    ],
    [
      "a non-integer",
      { heightUnits: 2.5 },
      "generator.params.heightUnits: Invalid input: expected int, received number",
    ],
    [
      "missing params",
      undefined,
      "generator.params: Invalid input: expected object, received undefined",
    ],
  ])("rejects %s with a 400 naming the field", (_label, params, field) => {
    expect(rejection(job("gridfinity", params))).toStartWith(`400 ${field}`);
  });

  test("accepts an upload that exists and is an STL", () => {
    expect(rejection(job("passthrough", { uploadId: "good", filename: "a.stl" }))).toBe("accepted");
  });

  test.each([
    ["a missing upload", "gone", "generator.params.uploadId: upload gone not found"],
    ["an upload that is not an STL", "junk", "generator.params.uploadId: upload junk is not"],
    ["a path in the upload id", "../etc", "generator.params.uploadId: uploadId must be"],
  ])("rejects %s with a 400 naming uploadId", (_label, uploadId, field) => {
    expect(rejection(job("passthrough", { uploadId }))).toStartWith(`400 ${field}`);
  });

  test("rejects an unknown key on the upload generator too", () => {
    expect(rejection(job("passthrough", { uploadId: "good", path: "/etc" }))).toBe(
      "400 generator.params.path: unknown field",
    );
  });

  test("answers a generic 400 for an unreadable upload without the data dir", () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const uploadDir = process.env.UPLOAD_DIR;
    process.env.UPLOAD_DIR = join(dir, "good.stl");
    try {
      const answer = rejection(job("passthrough", { uploadId: "good" }));
      expect(answer).toBe("400 generator.params.uploadId: upload good could not be read");
      expect(answer).not.toContain(dir);
    } finally {
      process.env.UPLOAD_DIR = uploadDir;
      logged.mockRestore();
    }
  });

  test("parseGeneratorParams refuses a generator it does not know", () => {
    expect(parseGeneratorParams(job("openscad", {}))).toEqual({
      ok: false,
      error: "unknown generator: openscad",
    });
  });
});

describe("POST /jobs on the sqlite queue", () => {
  const post = (body: unknown) =>
    fetch(`${base}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  test("answers 400 naming the field for bad params", async () => {
    const res = await post(job("gridfinity", { gridX: 0 }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('"error":"generator.params.gridX:');
  });

  test("queues a job with valid params", async () => {
    expect((await post(job("gridfinity", {}))).status).toBe(202);
  });

  test.each([
    [
      "a generator that is not an object",
      { generator: "gridfinity", printerId: "klipper-garage", profileId: "orca/klipper-pla-0.2" },
      "generator: Invalid input: expected object, received string",
    ],
    [
      "a missing printer and profile",
      { generator: { id: "gridfinity", params: {} } },
      "printerId: Invalid input: expected string, received undefined; profileId: Invalid input: expected string, received undefined",
    ],
    [
      "a body that is not an object",
      "job",
      "body: Invalid input: expected object, received string",
    ],
  ])("answers a string 400 naming the field for %s", async (_label, body, error) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });
});
