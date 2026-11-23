import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, sh } from "../test-repo";
import { checkRatchet, serializePercent } from "./ratchet";
import {
  type MoveFacts,
  parseReclassifications,
  RECLASSIFIED_PATH,
  type Reclassification,
  reclassificationFloors,
} from "./reclassified";
import { linesAt, renamedSince } from "./runner";

const FROM = "packages/worker/src/pipeline-harness.ts";
const TO = "packages/worker/test/helpers/pipeline-harness.ts";
const MOVE: Reclassification = { package: "worker", from: FROM, to: TO, floor: 82.34 };

const facts = (overrides: Partial<MoveFacts> = {}): MoveFacts => ({
  renamed: (from, to) => from === FROM && to === TO,
  changes: [],
  baseLines: (path) => (path === FROM ? 130 : null),
  current: {
    api: { hit: 1, found: 1 },
    worker: { hit: 788, found: 957 },
    shared: { hit: 1, found: 1 },
    plugins: { hit: 1, found: 1 },
  },
  base: { worker: 83.99 },
  committed: { worker: 82.34 },
  ...overrides,
});

describe("reclassificationFloors", () => {
  test("allows the committed floor for a recorded move of a source into a helper folder", () => {
    const result = reclassificationFloors([MOVE], [], facts());
    expect(result.floors).toEqual({ worker: 82.34 });
    expect(result.errors).toEqual([]);
  });

  test("ignores an entry the base already records, so the allowance applies once", () => {
    expect(reclassificationFloors([MOVE], [MOVE], facts())).toEqual({
      floors: {},
      errors: [],
      notes: [],
    });
  });

  test.each([
    [
      "a source moved anywhere but a helper folder",
      { ...MOVE, to: "packages/worker/src/harness.ts" },
      "is not in a declared worker test helper folder",
    ],
    [
      "a file that was not a source",
      { ...MOVE, from: "packages/worker/src/x.test.ts" },
      "is not a worker source file",
    ],
    ["the wrong package", { ...MOVE, package: "api" }, "is not a api source file"],
    [
      "a helper folder of another package",
      { ...MOVE, to: "packages/shared/test/helpers/pipeline-harness.ts" },
      "is not in a declared worker test helper folder",
    ],
    [
      "a floor other than the committed one",
      { ...MOVE, floor: 80 },
      "must equal the committed worker baseline",
    ],
  ])("refuses %s", (_case, entry, message) => {
    const result = reclassificationFloors([entry], [], facts());
    expect(result.floors).toEqual({});
    expect(result.errors.join("\n")).toContain(message);
  });

  test("refuses an entry git does not see as a move", () => {
    const result = reclassificationFloors([MOVE], [], facts({ renamed: () => false }));
    expect(result.errors.join("\n")).toContain("git does not see this move");
  });

  test.each([0, null])("refuses a move whose file has %p lines on the base", (lines) => {
    const result = reclassificationFloors([MOVE], [], facts({ baseLines: () => lines }));
    expect(result.floors).toEqual({});
    expect(result.errors.join("\n")).toContain(`${FROM} has no lines on the base`);
  });

  test("allows a move that explains exactly the base floor", () => {
    const exact = facts({
      current: { ...facts().current, worker: { hit: 700, found: 900 } },
      baseLines: () => 100,
      base: { worker: 80 },
      committed: { worker: 77.78 },
    });
    const result = reclassificationFloors([{ ...MOVE, floor: 77.78 }], [], exact);
    expect(result.errors).toEqual([]);
    expect(result.floors).toEqual({ worker: 77.78 });
  });

  test("refuses a drop bigger than the moved lines can explain", () => {
    const lower = facts({
      current: { ...facts().current, worker: { hit: 765, found: 957 } },
      committed: { worker: 79.94 },
    });
    const result = reclassificationFloors([{ ...MOVE, floor: 79.94 }], [], lower);
    expect(result.floors).toEqual({});
    expect(result.errors).toEqual([
      `${RECLASSIFIED_PATH}: moving 130 lines explains worker coverage of at most 82.34%, not the base's 83.99%`,
    ]);
  });
});

describe("parseReclassifications", () => {
  test("reads a missing file as no entries and refuses a malformed one", () => {
    expect(parseReclassifications(null)).toEqual([]);
    expect(parseReclassifications(JSON.stringify([MOVE]))).toEqual([MOVE]);
    expect(typeof parseReclassifications('[{"package":"worker"}]')).toBe("string");
    expect(typeof parseReclassifications("not json")).toBe("string");
  });
});

describe("checkRatchet with a reclassified floor", () => {
  const texts = (worker: number) => ({
    api: serializePercent(90),
    worker: serializePercent(worker),
    shared: serializePercent(90),
    plugins: serializePercent(90),
  });
  const input = {
    current: { api: 90, worker: 82.34, shared: 90, plugins: 90 },
    committed: texts(82.34),
    base: texts(83.99),
    baseHasChecker: true,
  };

  test("refuses the lower floor without the allowance and accepts it with one", () => {
    expect(checkRatchet(input).errors).toContain(
      "worker: line coverage 82.34% dropped below base 83.99%",
    );
    expect(checkRatchet({ ...input, reclassifiedFloors: { worker: 82.34 } }).errors).toEqual([]);
  });
});

const scratch = mkdtempSync(join(tmpdir(), "conveyor-reclassified-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("the git facts behind an allowance", () => {
  test("renamedSince sees a move and linesAt counts the file's lines on the base", () => {
    const root = mkdtempSync(join(scratch, "repo-"));
    mkdirSync(join(root, "packages/worker/src"), { recursive: true });
    mkdirSync(join(root, "packages/worker/test/helpers"), { recursive: true });
    sh(root, ["git", "init", "-q", "-b", "main"]);
    const harness = "export const harness = () => {\n\n  return 1;\n};\nexport type H = number;\n";
    const base = commit(root, { [FROM]: harness }, "base");
    sh(root, ["git", "mv", FROM, TO]);
    commit(root, {}, "move");
    expect(renamedSince(base, root)(FROM, TO)).toBe(true);
    expect(renamedSince(base, root)(TO, FROM)).toBe(false);
    expect(linesAt(base, root)(FROM)).toBe(3);
    expect(linesAt(base, root)("missing.ts")).toBeNull();
  });
});
