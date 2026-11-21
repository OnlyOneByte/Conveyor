import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  exhaustive,
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
import { messageOf } from "./run.js";

export interface ProfileForSlice {
  profile: ProfileRef;
  source: "bundled" | "edited";
  cleanup(): Promise<void>;
}

type ProfileDb = ReturnType<typeof openDb>;

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

async function removeLeftover(directory: string): Promise<string> {
  return rm(directory, { recursive: true, force: true }).then(
    () => "",
    (error: unknown) => `; partial profile not removed: ${messageOf(error)}`,
  );
}

async function materialize(
  profileName: string,
  directory: string,
  write: () => Promise<void>,
): Promise<ProfileForSlice["cleanup"]> {
  try {
    await rm(directory, { recursive: true, force: true });
    await write();
  } catch (error) {
    const leftover = await removeLeftover(directory);
    throw new StageError(
      "slicer",
      `failed to materialize ${profileName}: ${messageOf(error)}${leftover}`,
      { cause: error },
    );
  }
  return () => rm(directory, { recursive: true, force: true });
}

async function writeOrca(target: JobTarget, directory: string, db: ProfileDb) {
  const documents = dbGetOrcaProfileDocuments(db, target.profileId);
  if (!documents) return undefined;
  return materialize(`Orca profile ${target.profileId}`, directory, async () => {
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
  });
}

async function writePrusa(target: JobTarget, directory: string, db: ProfileDb) {
  const document = dbGetPrusaProfileContent(db, target.profileId);
  if (!document) return undefined;
  return materialize(`Prusa profile ${target.profileId}`, directory, async () => {
    validatePrusaProfileContent(document);
    await mkdir(directory, { mode: 0o700 });
    await writeFile(join(directory, `${PRUSA_PROFILE_DOCUMENT_NAME}.ini`), document.config, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  });
}

async function writeEdited(
  target: JobTarget,
  directory: string,
  db: ProfileDb,
): Promise<ProfileForSlice["cleanup"] | undefined> {
  const format = slicerFormat(target.slicerId);
  switch (format) {
    case "orca-json":
      return writeOrca(target, directory, db);
    case "prusa-ini":
      return writePrusa(target, directory, db);
    case null:
      return undefined;
    default:
      return exhaustive(format);
  }
}

export async function resolveProfileForSlice(
  target: JobTarget,
  workDir: string,
  db: ProfileDb = openDb(),
): Promise<ProfileForSlice> {
  const bundled: ProfileRef = {
    id: target.profileId,
    name: target.profileName,
    path: await bundledDirectory(target),
  };
  const directory = join(workDir, "profile");
  const cleanup = await writeEdited(target, directory, db);
  if (!cleanup) return { profile: bundled, source: "bundled", cleanup: noCleanup };
  return { profile: { ...bundled, path: directory }, source: "edited", cleanup };
}
