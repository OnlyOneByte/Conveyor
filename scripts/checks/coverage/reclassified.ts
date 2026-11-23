import { BASELINE_DIR, type Percents } from "./ratchet";
import {
  isSource,
  isTestFile,
  PACKAGES,
  packageOf,
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

export interface MoveFacts {
  renamed: (from: string, to: string) => boolean;
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
