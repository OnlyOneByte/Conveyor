import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALLOWLIST, allowlistErrors, MAX_DAYS } from "./image-scan-allowlist";

const ROOT = join(import.meta.dir, "..", "..");
const TODAY = new Date("2026-11-25T00:00:00Z");
const REASON = "only reachable through npm, which the image never runs";

const entry = (fields: string) => `vulnerabilities:\n  - ${fields.split("\n").join("\n    ")}\n`;

describe("the image-scan allowlist", () => {
  test("the committed file is valid today", () => {
    expect(allowlistErrors(readFileSync(join(ROOT, ALLOWLIST), "utf8"), new Date())).toEqual([]);
  });

  test("accepts an entry with an id, a reason and a near expiry", () => {
    const text = entry(`id: CVE-2026-85091\nstatement: ${REASON}\nexpired_at: 2027-01-31`);
    expect(allowlistErrors(text, TODAY)).toEqual([]);
    const ghsa = entry(`id: GHSA-2x3w-cq4m-9vfr\nstatement: ${REASON}\nexpired_at: 2027-01-31`);
    expect(allowlistErrors(ghsa, TODAY)).toEqual([]);
  });

  test.each([
    ["no reason", "id: CVE-2026-85091\nexpired_at: 2027-01-31", "statement must give the reason"],
    ["a short reason", "id: CVE-2026-85091\nstatement: ok\nexpired_at: 2027-01-31", "statement"],
    [
      "no expiry",
      `id: CVE-2026-85091\nstatement: ${REASON}`,
      "expired_at must be a real YYYY-MM-DD date",
    ],
    ["a bad expiry", `id: CVE-2026-85091\nstatement: ${REASON}\nexpired_at: soon`, "YYYY-MM-DD"],
    [
      "a date that doesn't exist",
      `id: CVE-2026-85091\nstatement: ${REASON}\nexpired_at: 2027-02-30`,
      "expired_at must be a real YYYY-MM-DD date",
    ],
    [
      "an expiry too far away",
      `id: CVE-2026-85091\nstatement: ${REASON}\nexpired_at: 2027-12-31`,
      `more than ${MAX_DAYS} days away`,
    ],
    ["no id", `statement: ${REASON}\nexpired_at: 2027-01-31`, "id must be a CVE or GHSA id"],
    ["a wildcard id", `id: CVE-*\nstatement: ${REASON}\nexpired_at: 2027-01-31`, "CVE or GHSA"],
  ])("refuses %s", (_name, fields, message) => {
    const errors = allowlistErrors(entry(fields), TODAY);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });

  test.each([
    ["id", `id: CVE-2026-85091\nid: CVE-2026-124851\nstatement: ${REASON}\nexpired_at: 2027-01-31`],
    [
      "expired_at",
      `id: CVE-2026-85091\nstatement: ${REASON}\nexpired_at: 2099-01-01\nexpired_at: 2027-01-31`,
    ],
  ])(
    "refuses a duplicate %s in one entry, which YAML would read as its last value",
    (key, fields) => {
      expect(allowlistErrors(entry(fields), TODAY)).toEqual([
        `${ALLOWLIST} line ${key === "id" ? 3 : 5}: ${key} appears twice in one mapping`,
      ]);
    },
  );

  test("refuses a duplicate top-level key, and accepts two entries with the same fields", () => {
    expect(allowlistErrors("vulnerabilities: []\nvulnerabilities: []\n", TODAY)).toEqual([
      `${ALLOWLIST} line 2: vulnerabilities appears twice in one mapping`,
    ]);
    const one = `id: CVE-2026-85091\nstatement: ${REASON}\nexpired_at: 2027-01-31`;
    const two = `  - id: CVE-2026-124851\n    statement: ${REASON}\n    expired_at: 2027-01-31\n`;
    expect(allowlistErrors(entry(one) + two, TODAY)).toEqual([]);
  });

  test("refuses other kinds of suppression and a missing list", () => {
    expect(allowlistErrors("vulnerabilities: []\nmisconfigurations: []\n", TODAY)).toEqual([
      `${ALLOWLIST} accepts only vulnerabilities, not misconfigurations`,
    ]);
    expect(allowlistErrors("{}\n", TODAY)).toEqual([
      `${ALLOWLIST} must hold a vulnerabilities list`,
    ]);
  });
});
