import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

describe("the engine log", () => {
  const logRefusal = async (id: string) => {
    const err = await resolveJobArtifact(id, "log").catch((e: unknown) => e);
    if (!(err instanceof ArtifactError)) throw new Error(`expected an ArtifactError, got ${err}`);
    return [err.statusCode, err.message];
  };

  test("is served from the job's own folder as engine.log", async () => {
    mkdirSync(join(dataDir, "logged"));
    writeFileSync(join(dataDir, "logged", "engine.log"), "$ prusa-slicer\n[exited 1]\n");
    job("logged");
    expect(await resolveJobArtifact("logged", "log")).toMatchObject({
      path: realpathSync(join(dataDir, "logged", "engine.log")),
      filename: "engine.log",
      contentType: "text/plain; charset=utf-8",
      size: 26,
    });
  });

  test("answers 404 for an unknown job and 410 when no log is on disk", async () => {
    expect((await logRefusal("never-ran"))[0]).toBe(404);
    mkdirSync(join(dataDir, "no-log"));
    job("no-log");
    expect((await logRefusal("no-log"))[0]).toBe(410);
  });

  test("is refused while the job is still running", async () => {
    mkdirSync(join(dataDir, "running"));
    writeFileSync(join(dataDir, "running", "engine.log"), "$ orca-slicer\n");
    dbRecordJob(db, {
      id: "running",
      generatorId: "gridfinity",
      printerId: "klipper-garage",
      profileId: "orca/klipper-pla-0.2",
      state: "slicing",
    });
    expect(await logRefusal("running")).toEqual([
      404,
      "job running hasn't settled yet, so its engine log isn't ready",
    ]);
  });

  test("a symlinked engine.log that leaves the job's folder is refused", async () => {
    mkdirSync(join(dataDir, "log-link"));
    writeFileSync(join(dataDir, "secret.txt"), "x");
    symlinkSync(join(dataDir, "secret.txt"), join(dataDir, "log-link", "engine.log"));
    job("log-link");
    expect(await logRefusal("log-link")).toEqual([
      404,
      "the log artifact path escapes the job work directory",
    ]);
  });
});
