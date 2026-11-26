import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tempDirs } from "../../packages/shared/test/helpers/temp.ts";
import { listedPrefix } from "../../packages/shared/test/helpers/temp-prefixes.ts";
import { SCANNED, type TempDirCall, tempDirCalls } from "./temp-prefix-scan";
import { leakErrors, NO_TMPDIR } from "./test-leaks";

const ROOT = join(import.meta.dir, "..", "..");

const CHECK = join(ROOT, "scripts", "checks", "test-leaks.ts");
const dirs = tempDirs("conveyor-leaks-");

const withoutRedis = (tmp: string | undefined) => {
  const { REDIS_URL: _redis, TMPDIR: _tmp, ...env } = process.env;
  return tmp === undefined ? env : { ...env, TMPDIR: tmp };
};

const runCheck = (tmp: string | undefined) => {
  const run = Bun.spawnSync([process.execPath, CHECK], { cwd: ROOT, env: withoutRedis(tmp) });
  return { code: run.exitCode, out: `${run.stdout}${run.stderr}` };
};

describe("leakErrors", () => {
  test("passes when the temp dir is empty and no Redis key is left", () => {
    expect(leakErrors("/t", [], [])).toEqual([]);
    expect(leakErrors("/t", [], null)).toEqual([]);
  });

  test("reports every entry left, whatever its name, sorted", () => {
    expect(leakErrors("/t", ["x", "bun-cache", "conveyor-a1"], [])).toEqual([
      "the tests left 3 temp entries in /t: bun-cache, conveyor-a1, x",
    ]);
  });

  test("names the Redis keys left, and caps a long list", () => {
    const keys = Array.from({ length: 12 }, (_, i) => `job:${String(i).padStart(2, "0")}:seq`);
    expect(leakErrors("/t", [], ["jobs:active"])).toEqual([
      "the tests left 1 Redis keys: jobs:active",
    ]);
    expect(leakErrors("/t", [], keys)[0]).toEndWith("job:09:seq, and 2 more");
  });

  test("reports temp entries and Redis keys together", () => {
    expect(leakErrors("/t", ["x"], ["jobs:active"])).toHaveLength(2);
  });
});

describe("check:test-leaks", () => {
  test("refuses to run without TMPDIR", () => {
    expect(runCheck(undefined)).toEqual({ code: 1, out: `${NO_TMPDIR}\n` });
  });

  test("passes on an empty TMPDIR", async () => {
    const tmp = await dirs();
    expect(runCheck(tmp)).toEqual({ code: 0, out: `no test leaks: ${tmp} is empty\n` });
  });

  test("fails on a file Bun.write left under tmpdir(), which no prefix names", async () => {
    const tmp = await dirs();
    const leak =
      'await Bun.write(require("node:path").join(require("node:os").tmpdir(), "x"), "left")';
    const writer = Bun.spawnSync([process.execPath, "--eval", leak], {
      cwd: tmp,
      env: withoutRedis(tmp),
    });
    expect(writer.exitCode).toBe(0);
    expect(runCheck(tmp)).toEqual({
      code: 1,
      out: `the tests left 1 temp entries in ${tmp}: x\n`,
    });
  });
});

const problemOf = (file: string, call: TempDirCall): string | null => {
  if (call.kind === "unreadable")
    return `${file}:${call.line}: mkdtemp's first argument isn't join(tmpdir(), <literal prefix>): ${call.arg}`;
  if (call.kind === "listed" && !listedPrefix(call.prefix))
    return `${file}:${call.line}: ${call.prefix} isn't in TEMP_PREFIXES`;
  return null;
};

describe("the listed prefixes", () => {
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
