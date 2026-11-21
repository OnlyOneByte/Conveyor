import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  isBundledProfilePath,
  type JobTarget,
  ORCA_PROFILE_DOCUMENT_NAMES,
  PRUSA_PROFILE_DOCUMENT_NAME,
  type ProfileRef,
  StageError,
  slicerFormat,
  validateOrcaProfileDocuments,
  validatePrusaProfileContent,
} from "@conveyor/shared";
import { dbGetOrcaProfileDocuments, dbGetPrusaProfileContent, openDb } from "@conveyor/shared/db";

export interface ProfileForSlice {
  profile: ProfileRef;
  source: "bundled" | "edited";
  cleanup(): Promise<void>;
}

const noCleanup = async () => {};

async function bundledDirectory(target: JobTarget): Promise<string> {
  if (!isBundledProfilePath(target.profilePath)) {
    throw new StageError("slicer", `profile ${target.profileId} has an invalid bundled path`);
  }
  let root: string;
  let directory: string;
  try {
    root = await realpath(resolve(process.env.CONVEYOR_PROFILES_ROOT ?? "/profiles"));
    directory = await realpath(join(root, basename(target.profilePath)));
  } catch (error) {
    throw new StageError("slicer", `bundled profile ${target.profileId} is unavailable`, {
      cause: error,
    });
  }
  const rel = relative(root, directory);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new StageError("slicer", `profile ${target.profileId} escapes the bundled profile root`);
  }
  return directory;
}

export async function resolveProfileForSlice(
  target: JobTarget,
  workDir: string,
  db: ReturnType<typeof openDb> = openDb(),
): Promise<ProfileForSlice> {
  const bundled: ProfileRef = {
    id: target.profileId,
    name: target.profileName,
    path: await bundledDirectory(target),
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
      await rm(directory, { recursive: true, force: true });
      validatePrusaProfileContent(document);
      await mkdir(directory, { mode: 0o700 });
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

  return { profile: bundled, source: "bundled", cleanup: noCleanup };
}
