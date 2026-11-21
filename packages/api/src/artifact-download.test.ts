import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbRecordJob, openDb } from "@conveyor/shared/db";
import { ArtifactError, resolveJobArtifact } from "./artifact-download.ts";

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-artifact-"));
const dataDir = join(dir, "data");
mkdirSync(dataDir);
const previous = { DATA_DIR: process.env.DATA_DIR, DB_PATH: process.env.DB_PATH };
process.env.DATA_DIR = dataDir;
process.env.DB_PATH = join(dir, "conveyor.db");
const db = openDb(process.env.DB_PATH);

afterAll(() => {
  db.close();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

function job(id: string, modelPath?: string): void {
  dbRecordJob(db, {
    id,
    generatorId: "gridfinity",
    params: {},
    printerId: "klipper-garage",
    profileId: "orca/klipper-pla-0.2",
    state: "done",
    modelPath,
  });
}

async function refusal(id: string): Promise<[number, string]> {
  const err = await resolveJobArtifact(id, "model").catch((e: unknown) => e);
  if (!(err instanceof ArtifactError)) throw new Error(`expected an ArtifactError, got ${err}`);
  return [err.statusCode, err.message];
}

describe("resolveJobArtifact", () => {
  test("serves a recorded file inside the job's own directory", async () => {
    mkdirSync(join(dataDir, "ok"));
    writeFileSync(join(dataDir, "ok", "model.stl"), "solid x");
    job("ok", join(dataDir, "ok", "model.stl"));
    expect(await resolveJobArtifact("ok", "model")).toMatchObject({
      size: 7,
      filename: "model.stl",
    });
  });

  test("answers 404 for an unknown job or one with no artifact recorded", async () => {
    expect((await refusal("nope"))[0]).toBe(404);
    job("bare");
    expect(await refusal("bare")).toEqual([404, "job bare has no model artifact recorded"]);
  });

  test("answers 410 once the recorded file or the work directory is gone", async () => {
    mkdirSync(join(dataDir, "gone"));
    job("gone", join(dataDir, "gone", "model.stl"));
    expect((await refusal("gone"))[0]).toBe(410);
    writeFileSync(join(dir, "elsewhere.stl"), "x");
    job("reaped", join(dir, "elsewhere.stl"));
    expect(await refusal("reaped")).toEqual([
      410,
      "the work directory for job reaped is no longer on disk",
    ]);
    mkdirSync(join(dataDir, "dir", "model.stl"), { recursive: true });
    job("dir", join(dataDir, "dir", "model.stl"));
    expect((await refusal("dir"))[0]).toBe(410);
  });

  test("answers 404 for a path that escapes the job's directory, symlinks included", async () => {
    mkdirSync(join(dataDir, "esc"));
    writeFileSync(join(dataDir, "secret.txt"), "x");
    job("esc", join(dataDir, "esc", "..", "secret.txt"));
    expect(await refusal("esc")).toEqual([
      404,
      "the model artifact path escapes the job work directory",
    ]);
    mkdirSync(join(dataDir, "link"));
    symlinkSync(join(dataDir, "secret.txt"), join(dataDir, "link", "model.stl"));
    job("link", join(dataDir, "link", "model.stl"));
    expect((await refusal("link"))[0]).toBe(404);
  });
});
