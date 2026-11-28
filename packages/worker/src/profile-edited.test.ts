import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobTarget } from "@conveyor/shared";
import {
  dbSaveOrcaProfileDocuments,
  dbSavePrusaProfileContent,
  dbUpsertProfile,
  openDb,
} from "@conveyor/shared/db";
import { resolveProfileForSlice } from "./profile";

const repoProfiles = join(import.meta.dir, "..", "..", "..", "profiles");
const previousRoot = process.env.CONVEYOR_PROFILES_ROOT;
const bundled = (profile: string, file: string) =>
  readFileSync(join(repoProfiles, profile, file), "utf8");

beforeAll(() => {
  process.env.CONVEYOR_PROFILES_ROOT = repoProfiles;
});

afterAll(() => {
  if (previousRoot === undefined) delete process.env.CONVEYOR_PROFILES_ROOT;
  else process.env.CONVEYOR_PROFILES_ROOT = previousRoot;
});

const modeOf = (path: string) => (statSync(path).mode & 0o777).toString(8);

async function inWorkDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "conveyor-profile-edited-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function target(slicerId: string, folder: string, profileId: string): JobTarget {
  return {
    printerId: "p",
    transportId: "moonraker",
    profileId,
    profileName: "Edited",
    profilePath: `/profiles/${folder}`,
    slicerId,
    gcodeFlavor: "klipper",
  };
}

describe("an edited profile", () => {
  test("is written for Orca as its three documents, owner-only, and removed by its cleanup", async () => {
    const db = openDb(":memory:");
    const folder = "orca-klipper-pla-0.2";
    dbUpsertProfile(db, {
      id: "orca-edited",
      slicerId: "orca",
      name: "Edited",
      path: `/profiles/${folder}`,
      gcodeFlavor: "klipper",
    });
    const documents = {
      machine: bundled(folder, "machine.json"),
      process: bundled(folder, "process.json"),
      filament: bundled(folder, "filament.json"),
    };
    expect(dbSaveOrcaProfileDocuments(db, "orca-edited", documents)).toBe(true);
    await inWorkDir(async (dir) => {
      const made = await resolveProfileForSlice(target("orca", folder, "orca-edited"), dir, db);
      const path = join(dir, "profile");
      expect([made.source, made.profile.path, made.profile.id]).toEqual([
        "edited",
        path,
        "orca-edited",
      ]);
      expect(modeOf(path)).toBe("700");
      const names: (keyof typeof documents)[] = ["machine", "process", "filament"];
      for (const name of names) {
        expect(readFileSync(join(path, `${name}.json`), "utf8")).toBe(documents[name]);
        expect(modeOf(join(path, `${name}.json`))).toBe("600");
      }
      await made.cleanup();
      expect(existsSync(path)).toBe(false);
    });
  });

  test("is written for Prusa as its config.ini, owner-only, and removed by its cleanup", async () => {
    const db = openDb(":memory:");
    const folder = "prusa-klipper-pla-0.2";
    dbUpsertProfile(db, {
      id: "prusa-edited",
      slicerId: "prusa",
      name: "Edited",
      path: `/profiles/${folder}`,
      gcodeFlavor: "klipper",
    });
    const config = bundled(folder, "config.ini");
    expect(dbSavePrusaProfileContent(db, "prusa-edited", { config })).toBe(true);
    await inWorkDir(async (dir) => {
      const made = await resolveProfileForSlice(target("prusa", folder, "prusa-edited"), dir, db);
      const path = join(dir, "profile");
      expect([made.source, made.profile.path]).toEqual(["edited", path]);
      expect(readFileSync(join(path, "config.ini"), "utf8")).toBe(config);
      expect(modeOf(join(path, "config.ini"))).toBe("600");
      await made.cleanup();
      expect(existsSync(path)).toBe(false);
    });
  });

  test("is ignored for a slicer with no edited format, which slices from the bundle", async () => {
    const db = openDb(":memory:");
    await inWorkDir(async (dir) => {
      const made = await resolveProfileForSlice(
        target("cura", "prusa-klipper-pla-0.2", "x"),
        dir,
        db,
      );
      expect(made.source).toBe("bundled");
      expect(existsSync(join(dir, "profile"))).toBe(false);
    });
  });
});
