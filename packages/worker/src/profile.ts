import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ORCA_PROFILE_DOCUMENT_NAMES,
  StageError,
  validateOrcaProfileDocuments,
  type JobTarget,
  type ProfileRef,
} from "@conveyor/shared";
import { dbGetOrcaProfileDocuments, openDb } from "@conveyor/shared/db";

export interface ProfileForSlice {
  profile: ProfileRef;
  source: "bundled" | "edited";
  /** Idempotent cleanup. Bundled profiles return a no-op. */
  cleanup(): Promise<void>;
}

const noCleanup = async () => {};

/**
 * Resolve the actual profile directory an adapter should consume.
 *
 * Bundled profiles keep their immutable /profiles path. An edited Orca profile is
 * validated again at the worker trust boundary, then written under the service-owned
 * per-job work directory using only fixed names. Neither profile id nor request input
 * participates in a filesystem path.
 */
export async function resolveProfileForSlice(
  target: JobTarget,
  workDir: string,
  db: ReturnType<typeof openDb> = openDb(),
): Promise<ProfileForSlice> {
  const bundled: ProfileRef = {
    id: target.profileId,
    name: target.profileName,
    path: target.profilePath,
  };

  // Prusa is deliberately read-only in the first editor version. Orca without stored
  // content follows the existing immutable-bundle path unchanged.
  if (target.slicerId !== "orca") return { profile: bundled, source: "bundled", cleanup: noCleanup };
  const documents = dbGetOrcaProfileDocuments(db, target.profileId);
  if (!documents) return { profile: bundled, source: "bundled", cleanup: noCleanup };

  const directory = join(workDir, "profile");
  try {
    // A crashed prior attempt may have left this fixed child behind. Remove the child
    // (a symlink is removed, not followed) before recreating it with private access.
    await rm(directory, { recursive: true, force: true });
    validateOrcaProfileDocuments(documents);
    await mkdir(directory, { mode: 0o700 });
    await Promise.all(
      ORCA_PROFILE_DOCUMENT_NAMES.map((name) =>
        writeFile(join(directory, `${name}.json`), documents[name], {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        }),
      ),
    );
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw new StageError(
      "slicer",
      `failed to materialize Orca profile ${target.profileId}: ${(error as Error).message}`,
      { cause: error },
    );
  }

  return {
    profile: { ...bundled, path: directory },
    source: "edited",
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}
