import { BASELINE_DIR, type Percents } from "./ratchet";
import {
  isSource,
  isTestFile,
  PACKAGES,
  packageOf,
  rawPackageOf,
  round2,
  type Summary,
  TEST_HELPER_DIRS,
} from "./summary";

export const RECLASSIFIED_PATH = `${BASELINE_DIR}/reclassified.json`;

export interface Reclassification {
  package: string;
  from: string;
  to: string;
  floor: number;
}

const isEntry = (value: unknown): value is Reclassification => {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.package === "string" &&
    typeof entry.from === "string" &&
    typeof entry.to === "string" &&
    typeof entry.floor === "number" &&
    Number.isFinite(entry.floor)
  );
};

export function parseReclassifications(text: string | null): Reclassification[] | string {
  if (text === null) return [];
  try {
    const value: unknown = JSON.parse(text);
    if (Array.isArray(value) && value.every(isEntry)) return value;
  } catch {}
  return `${RECLASSIFIED_PATH} must be a JSON array of { package, from, to, floor }`;
}

export interface FileChange {
  from: string | null;
  to: string | null;
  renamed: boolean;
  opaque: boolean;
  removed: string[];
  added: string[];
}

export interface MoveFacts {
  renamed: (from: string, to: string) => boolean;
  changes: FileChange[] | null;
  baseLines: (from: string) => number | null;
  current: Summary;
  base: Percents;
  committed: Percents;
}

const sameEntry = (a: Reclassification, b: Reclassification) =>
  a.package === b.package && a.from === b.from && a.to === b.to && a.floor === b.floor;

function entryError(entry: Reclassification, facts: MoveFacts): string | null {
  const name = `${RECLASSIFIED_PATH}: ${entry.from} -> ${entry.to}`;
  if (!PACKAGES.some((known) => known === entry.package)) return `${name}: unknown package`;
  if (!isSource(entry.from) || packageOf(entry.from) !== entry.package) {
    return `${name}: ${entry.from} is not a ${entry.package} source file`;
  }
  const helper = TEST_HELPER_DIRS.some((dir) => entry.to.startsWith(dir)) && isTestFile(entry.to);
  if (!helper || packageOf(entry.to) !== entry.package) {
    return `${name}: ${entry.to} is not in a declared ${entry.package} test helper folder`;
  }
  if (!facts.renamed(entry.from, entry.to)) return `${name}: git does not see this move`;
  if ((facts.baseLines(entry.from) ?? 0) <= 0)
    return `${name}: ${entry.from} has no lines on the base`;
  if (round2(entry.floor) !== round2(facts.committed[entry.package] ?? Number.NaN)) {
    return `${name}: floor ${entry.floor} must equal the committed ${entry.package} baseline`;
  }
  return null;
}

const IMPORT_LINE =
  /^(\s*(?:(?:import|export)\b.*\bfrom|\}\s*from|import)\s*)(["'])[^"'\n]*\2(;?\s*)$/;

const withoutSpecifiers = (lines: string[]) =>
  lines.every((line) => IMPORT_LINE.test(line))
    ? lines
        .map((line) => line.replace(IMPORT_LINE, "$1$2$2$3"))
        .sort()
        .join("\n")
    : null;

const importPathsOnly = (change: FileChange) => {
  if (change.opaque) return false;
  const removed = withoutSpecifiers(change.removed);
  return removed !== null && removed === withoutSpecifiers(change.added);
};

const inPackage = (name: string, path: string | null) =>
  path !== null && (path.startsWith('"') || rawPackageOf(path) === name);

function rideAlongErrors(name: string, moves: Reclassification[], facts: MoveFacts): string[] {
  if (facts.changes === null) return [`${RECLASSIFIED_PATH}: could not read this PR's changes`];
  const allowed = (change: FileChange) =>
    (change.renamed
      ? moves.some((move) => move.from === change.from && move.to === change.to)
      : change.from !== null && change.from === change.to) && importPathsOnly(change);
  return facts.changes
    .filter((change) => inPackage(name, change.from) || inPackage(name, change.to))
    .filter((change) => !allowed(change))
    .map(
      (change) =>
        `${RECLASSIFIED_PATH}: ${change.to ?? change.from} changes ${name} beyond the recorded move and import-path edits`,
    );
}

export function reclassificationFloors(
  head: Reclassification[],
  base: Reclassification[],
  facts: MoveFacts,
): { floors: Record<string, number>; errors: string[]; notes: string[] } {
  const fresh = head.filter((entry) => !base.some((old) => sameEntry(old, entry)));
  const errors = fresh.flatMap((entry) => entryError(entry, facts) ?? []);
  if (errors.length > 0) return { floors: {}, errors, notes: [] };
  const floors: Record<string, number> = {};
  const notes: string[] = [];
  for (const name of new Set(fresh.map((entry) => entry.package))) {
    const moves = fresh.filter((entry) => entry.package === name);
    const rideAlong = rideAlongErrors(name, moves, facts);
    if (rideAlong.length > 0) {
      errors.push(...rideAlong);
      continue;
    }
    const floor = moves[0]?.floor ?? 0;
    const lines = moves.reduce((sum, entry) => sum + (facts.baseLines(entry.from) ?? 0), 0);
    const totals = facts.current[name as keyof Summary];
    const explained = round2((100 * (totals.hit + lines)) / (totals.found + lines));
    const baseFloor = facts.base[name] ?? 0;
    if (round2(baseFloor) > explained) {
      errors.push(
        `${RECLASSIFIED_PATH}: moving ${lines} lines explains ${name} coverage of at most ${explained}%, not the base's ${baseFloor}%`,
      );
    } else {
      floors[name] = floor;
      notes.push(
        `${name}: floor ${floor}% allowed by ${RECLASSIFIED_PATH}; moving ${lines} lines explains up to ${explained}% against the base's ${baseFloor}%`,
      );
    }
  }
  return { floors, errors, notes };
}
