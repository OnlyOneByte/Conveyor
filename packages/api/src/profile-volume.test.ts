import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbSaveOrcaProfileDocuments, dbUpsertProfile, openDb } from "@conveyor/shared/db";
import { profileVolume, readBundledOrcaDocuments } from "./profile-content";

const previousDbPath = process.env.DB_PATH;
const dir = mkdtempSync(join(tmpdir(), "conveyor-volume-"));

const profile = (id: string, slicerId: string, path: string) => ({
  id,
  slicerId,
  name: id,
  path,
  gcodeFlavor: "klipper",
});

beforeAll(() => {
  process.env.DB_PATH = join(dir, "conveyor.db");
});

afterAll(() => {
  openDb().close();
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
  rmSync(dir, { recursive: true, force: true });
});

describe("profileVolume", () => {
  test("reads a bundled Orca or Prusa profile's bed and height", async () => {
    const db = openDb();
    const orca = profile("v-orca", "orca", "/profiles/orca-klipper-pla-0.2");
    const prusa = profile("v-prusa", "prusa", "/profiles/prusa-klipper-pla-0.2");
    expect(await profileVolume(db, orca)).toEqual({ x: 220, y: 220, z: 250 });
    expect(await profileVolume(db, prusa)).toEqual({ x: 250, y: 250, z: 250 });
  });

  test("an edited profile's machine wins over the bundle", async () => {
    const db = openDb();
    const orca = profile("v-edited", "orca", "/profiles/orca-klipper-pla-0.2");
    dbUpsertProfile(db, orca);
    const documents = await readBundledOrcaDocuments(orca.path);
    const machine = {
      ...JSON.parse(documents.machine),
      printable_area: ["0x0", "180x0", "180x180", "0x180"],
    };
    dbSaveOrcaProfileDocuments(db, orca.id, { ...documents, machine: JSON.stringify(machine) });
    expect(await profileVolume(db, orca)).toEqual({ x: 180, y: 180, z: 250 });
  });

  test("an unknown slicer or a missing bundle gives no volume instead of an error", async () => {
    const db = openDb();
    expect(
      await profileVolume(db, profile("v-cura", "cura", "/profiles/orca-klipper-pla-0.2")),
    ).toBeNull();
    expect(await profileVolume(db, profile("v-gone", "orca", "/profiles/not-there"))).toBeNull();
  });

  test("a database or profile-path failure surfaces instead of reading as no bed size", async () => {
    const closed = new Database(":memory:");
    closed.close();
    const orca = profile("v-closed", "orca", "/profiles/orca-klipper-pla-0.2");
    await expect(profileVolume(closed, orca)).rejects.toThrow();
    const escaping = profile("v-escape", "prusa", "/etc/conveyor");
    await expect(profileVolume(openDb(), escaping)).rejects.toThrow("bundled /profiles path");
  });
});
