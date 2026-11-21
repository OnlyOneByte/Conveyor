import { PACKAGES, round2 } from "./summary";

export const BASELINE_PATH = "scripts/checks/coverage/baseline.json";

export const TOLERANCE = 0.5;

export type Percents = Record<string, number>;

export interface CoverageBaseline {
  lines: Percents;
}

const isPercent = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isCoverageBaseline = (value: unknown): value is CoverageBaseline =>
  isRecord(value) && isRecord(value.lines) && Object.values(value.lines).every(isPercent);

export function parseBaseline(text: string): CoverageBaseline | null {
  try {
    const value: unknown = JSON.parse(text);
    return isCoverageBaseline(value) ? value : null;
  } catch {
    return null;
  }
}

export function serializeBaseline(baseline: CoverageBaseline): string {
  const lines = Object.fromEntries(
    Object.entries(baseline.lines)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => [name, round2(value)]),
  );
  return `${JSON.stringify({ lines }, null, 2)}\n`;
}

export function raisedBaseline(current: Percents, committed: CoverageBaseline | null) {
  const previous = committed?.lines ?? {};
  const lines = Object.fromEntries(
    PACKAGES.map((name) => [name, Math.max(current[name] ?? 0, previous[name] ?? 0)]),
  );
  return { lines };
}

export interface RatchetInput {
  current: Percents;
  committed: string | null;
  base: string | null;
}

export interface RatchetResult {
  errors: string[];
}

interface Loaded {
  committed: CoverageBaseline;
  allowed: CoverageBaseline;
  bootstrap: boolean;
}

function load(input: RatchetInput): Loaded | string {
  if (input.committed === null) return `${BASELINE_PATH} is missing`;
  const committed = parseBaseline(input.committed);
  if (committed === null) return `${BASELINE_PATH} is not a valid baseline`;
  if (input.base === null) return { committed, allowed: committed, bootstrap: true };
  const allowed = parseBaseline(input.base);
  if (allowed === null) return `base ${BASELINE_PATH} is not a valid baseline`;
  return { committed, allowed, bootstrap: false };
}

const fmt = (value: number) => `${round2(value).toFixed(2)}%`;

function packageErrors(name: string, current: number, loaded: Loaded): string[] {
  const floor = loaded.allowed.lines[name] ?? 0;
  const claimed = loaded.committed.lines[name];
  if (claimed === undefined) return [`${name}: ${BASELINE_PATH} has no entry`];
  if (!loaded.bootstrap && round2(current) < round2(floor - TOLERANCE)) {
    return [`${name}: line coverage ${fmt(current)} dropped below base ${fmt(floor)}`];
  }
  if (!loaded.bootstrap && round2(claimed) < round2(floor)) {
    return [`${name}: baseline lowered to ${fmt(claimed)} (base has ${fmt(floor)})`];
  }
  if (round2(claimed) > round2(current + TOLERANCE)) {
    return [`${name}: baseline claims ${fmt(claimed)} but measured ${fmt(current)}`];
  }
  if (round2(current - claimed) >= TOLERANCE) {
    return [
      `${name}: line coverage ${fmt(current)} is ${TOLERANCE} or more above the committed ${fmt(claimed)}; run \`bun run check:coverage:update\` and commit it`,
    ];
  }
  return [];
}

export const updateRefusal = (env: Record<string, string | undefined>): string | null =>
  env.CI ? "--update is local only; commit the regenerated baseline instead" : null;

export function checkRatchet(input: RatchetInput): RatchetResult {
  const loaded = load(input);
  if (typeof loaded === "string") return { errors: [loaded] };
  return {
    errors: PACKAGES.flatMap((name) => packageErrors(name, input.current[name] ?? 0, loaded)),
  };
}
