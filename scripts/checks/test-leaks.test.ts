import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TEMP_PREFIXES, watchedPrefix } from "../../packages/shared/test/helpers/temp-prefixes.ts";
import { SCANNED, type TempDirCall, tempDirCalls } from "./temp-prefix-scan";
import { leakErrors } from "./test-leaks";

const ROOT = join(import.meta.dir, "..", "..");

describe("leakErrors", () => {
  test("passes when no watched temp entry and no Redis key is left", () => {
    expect(leakErrors("/tmp", ["bun-cache", "other-dir", "repo-x"], [])).toEqual([]);
    expect(leakErrors("/tmp", [], null)).toEqual([]);
  });

  test.each([...TEMP_PREFIXES])("reports a leftover %s entry", (prefix) => {
    expect(leakErrors("/tmp", [`${prefix}a1B2c3`, "other-dir"], [])).toEqual([
      `the tests left 1 temp entries in /tmp: ${prefix}a1B2c3`,
    ]);
  });

  test("names each leftover entry, sorted", () => {
    expect(leakErrors("/tmp", ["pr-meta-b2", "x", "conveyor-elegoo-a1"], [])).toEqual([
      "the tests left 2 temp entries in /tmp: conveyor-elegoo-a1, pr-meta-b2",
    ]);
  });

  test("names the Redis keys left, and caps a long list", () => {
    const keys = Array.from({ length: 12 }, (_, i) => `job:${String(i).padStart(2, "0")}:seq`);
    expect(leakErrors("/tmp", [], ["jobs:active"])).toEqual([
      "the tests left 1 Redis keys: jobs:active",
    ]);
    expect(leakErrors("/tmp", [], keys)[0]).toEndWith("job:09:seq, and 2 more");
  });

  test("reports temp entries and Redis keys together", () => {
    expect(leakErrors("/t", ["conveyor-x"], ["jobs:active"])).toHaveLength(2);
  });
});

const problemOf = (file: string, call: TempDirCall): string | null => {
  if (call.kind === "unreadable")
    return `${file}:${call.line}: mkdtemp's first argument isn't join(tmpdir(), <literal prefix>): ${call.arg}`;
  if (call.kind === "listed" && !watchedPrefix(call.prefix))
    return `${file}:${call.line}: ${call.prefix} isn't in TEMP_PREFIXES`;
  return null;
};

describe("the watched prefixes", () => {
  test("cover every temp dir a file in the repository makes, each under tmpdir() with a listed literal prefix", () => {
    const tracked = Bun.spawnSync(["git", "ls-files", "-z", ...SCANNED], { cwd: ROOT });
    const calls = tracked.stdout
      .toString()
      .split("\0")
      .filter(Boolean)
      .flatMap((file) =>
        tempDirCalls(readFileSync(join(ROOT, file), "utf8"), file).map((call) =>
          problemOf(file, call),
        ),
      );
    expect(calls.length).toBeGreaterThan(50);
    expect(calls.filter((problem) => problem !== null)).toEqual([]);
  });
});
