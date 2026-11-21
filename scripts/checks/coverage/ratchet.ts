import { PACKAGES, round2 } from "./summary";

export const BASELINE_DIR = "scripts/checks/coverage/baseline";

export const LEGACY_BASELINE_PATH = "scripts/checks/coverage/baseline.json";

export const baselinePath = (name: string) => `${BASELINE_DIR}/${name}.json`;

export const CHECKER_PATH = "scripts/checks/coverage/main.ts";

export const TOLERANCE = 0.5;

export type Percents = Record<string, number>;

export type BaselineTexts = Record<string, string | null>;

export interface CoverageBaseline {
  lines: Percents;
}

const isPercent = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export function parseBaseline(texts: BaselineTexts): CoverageBaseline | string | null {
  const present = Object.entries(texts).filter(
    (entry): entry is [string, string] => entry[1] !== null,
  );
  if (present.length === 0) return null;
  const lines: Percents = {};
  for (const [name, text] of present) {
    const value = parseJson(text);
    if (!isPercent(value)) return `${baselinePath(name)} is not a valid baseline`;
    lines[name] = value;
  }
  return { lines };
}

export const serializePercent = (value: number) => `${JSON.stringify(round2(value))}\n`;

export function legacyTexts(text: string): BaselineTexts | null {
  const value = parseJson(text);
  if (!isRecord(value) || !isRecord(value.lines)) return null;
  const lines = value.lines;
  if (!Object.values(lines).every(isPercent)) return null;
  return Object.fromEntries(
    PACKAGES.map((name) => {
      const percent = lines[name];
      return [name, isPercent(percent) ? serializePercent(percent) : null];
    }),
  );
}

export function raisedBaseline(current: Percents, committed: CoverageBaseline | null) {
  const previous = committed?.lines ?? {};
  const lines = Object.fromEntries(
    PACKAGES.map((name) => [name, Math.max(current[name] ?? 0, previous[name] ?? 0)]),
  );
  return { lines };
}

export function baselineWrites(current: Percents, committed: BaselineTexts): [string, string][] {
  const parsed = parseBaseline(committed);
  const raised = raisedBaseline(current, typeof parsed === "string" ? null : parsed);
  return PACKAGES.flatMap((name): [string, string][] => {
    const text = serializePercent(raised.lines[name] ?? 0);
    return text === committed[name] ? [] : [[baselinePath(name), text]];
  });
}

export interface RatchetInput {
  current: Percents;
  committed: BaselineTexts;
  base: BaselineTexts;
  baseHasChecker: boolean;
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
  const committed = parseBaseline(input.committed);
  if (committed === null) return `${BASELINE_DIR}/ is missing`;
  if (typeof committed === "string") return committed;
  const allowed = parseBaseline(input.base);
  if (allowed === null && input.baseHasChecker) {
    return `base has ${CHECKER_PATH} but no ${BASELINE_DIR}/; refusing to bootstrap`;
  }
  if (allowed === null) return { committed, allowed: committed, bootstrap: true };
  if (typeof allowed === "string") return `base ${allowed}`;
  return { committed, allowed, bootstrap: false };
}

const fmt = (value: number) => `${round2(value).toFixed(2)}%`;

function packageErrors(name: string, current: number, loaded: Loaded): string[] {
  const floor = loaded.allowed.lines[name] ?? 0;
  const claimed = loaded.committed.lines[name];
  if (claimed === undefined) return [`${name}: ${baselinePath(name)} is missing`];
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
