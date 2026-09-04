import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ORCA_PROFILE_DOCUMENT_NAMES,
  PRUSA_PROFILE_DOCUMENT_NAME,
  StageError,
  slicerFormat,
  validateOrcaProfileDocuments,
  validatePrusaProfileContent,
  type JobTarget,
  type ProfileRef,
} from "@conveyor/shared";
import { dbGetOrcaProfileDocuments, dbGetPrusaProfileContent, openDb } from "@conveyor/shared/db";

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
 * Bundled (unedited) profiles keep their immutable /profiles path. An edited profile
 * is re-validated at the worker trust boundary, then written under the service-owned
 * per-job work directory using only fixed filenames — neither the profile id nor any
 * request input participates in a filesystem path. Dispatches on the slicer's editable
 * format: Orca writes three JSON documents, Prusa writes one config.ini; a slicer with
 * no editable format always uses its bundled path.
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

  const format = slicerFormat(target.slicerId);
  const directory = join(workDir, "profile");

  if (format === "orca-json") {
    const documents = dbGetOrcaProfileDocuments(db, target.profileId);
    if (!documents) return { profile: bundled, source: "bundled", cleanup: noCleanup };
    try {
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

  if (format === "prusa-ini") {
    const document = dbGetPrusaProfileContent(db, target.profileId);
    if (!document) return { profile: bundled, source: "bundled", cleanup: noCleanup };
    try {
      // A crashed prior attempt may have left this fixed child behind. Remove it
      // (a symlink is removed, not followed) before recreating with private access.
      await rm(directory, { recursive: true, force: true });
      validatePrusaProfileContent(document);
      await mkdir(directory, { mode: 0o700 });
      // Only config.ini goes in this fresh dir, so the slicer's loadConfigs picks it
      // up as the single config — no bundled .ini leaks in alongside the edit.
      await writeFile(join(directory, `${PRUSA_PROFILE_DOCUMENT_NAME}.ini`), document.config, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => {});
      throw new StageError(
        "slicer",
        `failed to materialize Prusa profile ${target.profileId}: ${(error as Error).message}`,
        { cause: error },
      );
    }
    return {
      profile: { ...bundled, path: directory },
      source: "edited",
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  }

  // A slicer with no editable format always uses its immutable bundled path.
  return { profile: bundled, source: "bundled", cleanup: noCleanup };
}
