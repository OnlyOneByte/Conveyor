import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type JobTarget, StageError } from "@conveyor/shared";
import { dbUpsertProfile, openDb } from "@conveyor/shared/db";
import { resolveProfileForSlice } from "./profile";

const repoProfiles = join(import.meta.dir, "..", "..", "..", "profiles");
const previousRoot = process.env.CONVEYOR_PROFILES_ROOT;

beforeAll(() => {
  process.env.CONVEYOR_PROFILES_ROOT = repoProfiles;
});

afterAll(() => {
  process.env.CONVEYOR_PROFILES_ROOT = previousRoot;
});

const target = (overrides: Partial<JobTarget>): JobTarget => ({
  printerId: "p",
  transportId: "moonraker",
  profileId: "prof",
  profileName: "Profile",
  profilePath: "/profiles/prusa-klipper-pla-0.2",
  slicerId: "prusa",
  gcodeFlavor: "klipper",
  ...overrides,
});

const withWorkDir = async (fn: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), "conveyor-profile-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe("resolveProfileForSlice", () => {
  test.each(["/profiles/../etc", "/etc", "/profiles/a/b", "/data"])(
    "rejects profile path %p",
    async (profilePath) => {
      const db = openDb(":memory:");
      await withWorkDir(async (dir) => {
        await expect(resolveProfileForSlice(target({ profilePath }), dir, db)).rejects.toThrow(
          StageError,
        );
      });
    },
  );

  test("rejects an edited Prusa profile with a disallowed key stored directly in the db", async () => {
    const db = openDb(":memory:");
    dbUpsertProfile(db, {
      id: "edited-prusa",
      slicerId: "prusa",
      name: "Profile",
      path: "/profiles/prusa-klipper-pla-0.2",
      gcodeFlavor: "klipper",
    });
    db.prepare("UPDATE profiles SET prusa_ini = ? WHERE id = ?").run(
      "layer_height = 0.2\npost_process = x\n",
      "edited-prusa",
    );
    await withWorkDir(async (dir) => {
      await expect(
        resolveProfileForSlice(target({ profileId: "edited-prusa" }), dir, db),
      ).rejects.toThrow(StageError);
    });
  });

  test("rejects an edited Orca profile with a disallowed key stored directly in the db", async () => {
    const db = openDb(":memory:");
    dbUpsertProfile(db, {
      id: "edited-orca",
      slicerId: "orca",
      name: "Profile",
      path: "/profiles/orca-klipper-pla-0.2",
      gcodeFlavor: "klipper",
    });
    db.prepare(
      "UPDATE profiles SET orca_machine_json = ?, orca_process_json = ?, orca_filament_json = ? WHERE id = ?",
    ).run(
      '{"type":"machine"}',
      '{"type":"process","post_process":["x"]}',
      '{"type":"filament"}',
      "edited-orca",
    );
    await withWorkDir(async (dir) => {
      await expect(
        resolveProfileForSlice(
          target({
            profileId: "edited-orca",
            slicerId: "orca",
            profilePath: "/profiles/orca-klipper-pla-0.2",
          }),
          dir,
          db,
        ),
      ).rejects.toThrow(StageError);
    });
  });

  test("passes a valid bundled profile through", async () => {
    const db = openDb(":memory:");
    await withWorkDir(async (dir) => {
      const result = await resolveProfileForSlice(target({}), dir, db);
      expect(result.source).toBe("bundled");
      expect(result.profile.path).toBe(realpathSync(join(repoProfiles, "prusa-klipper-pla-0.2")));
    });
  });

  test("rejects a bundle that does not exist", async () => {
    const db = openDb(":memory:");
    await withWorkDir(async (dir) => {
      await expect(
        resolveProfileForSlice(target({ profilePath: "/profiles/missing" }), dir, db),
      ).rejects.toThrow(StageError);
    });
  });

  test("rejects a bundle that is a symlink out of the profiles root", async () => {
    const db = openDb(":memory:");
    await withWorkDir(async (dir) => {
      const root = join(dir, "root");
      await mkdir(join(dir, "outside"), { recursive: true });
      await mkdir(root);
      await symlink(join(dir, "outside"), join(root, "escape"));
      process.env.CONVEYOR_PROFILES_ROOT = root;
      try {
        await expect(
          resolveProfileForSlice(target({ profilePath: "/profiles/escape" }), dir, db),
        ).rejects.toThrow("escapes the bundled profile root");
      } finally {
        process.env.CONVEYOR_PROFILES_ROOT = repoProfiles;
      }
    });
  });
});
