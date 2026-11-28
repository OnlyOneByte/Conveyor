import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RedisClient } from "bun";
import { tempDirs } from "../../packages/shared/test/helpers/temp.ts";
import { listedPrefix } from "../../packages/shared/test/helpers/temp-prefixes.ts";
import { SCANNED, type TempDirCall, tempDirCalls } from "./temp-prefix-scan";
import { keyspaceDbs, leakErrors, NO_TMPDIR } from "./test-leaks";

const ROOT = join(import.meta.dir, "..", "..");

const CHECK = join(ROOT, "scripts", "checks", "test-leaks.ts");
const dirs = tempDirs("conveyor-leaks-");

const withoutRedis = (tmp: string | undefined) => {
  const { REDIS_URL: _redis, TMPDIR: _tmp, ...env } = process.env;
  return tmp === undefined ? env : { ...env, TMPDIR: tmp };
};

const runCheck = (tmp: string | undefined, redisUrl?: string) => {
  const env = redisUrl ? { ...withoutRedis(tmp), REDIS_URL: redisUrl } : withoutRedis(tmp);
  const run = Bun.spawnSync([process.execPath, CHECK], { cwd: ROOT, env });
  return { code: run.exitCode, out: `${run.stdout}${run.stderr}` };
};

const url = process.env.REDIS_URL;

const inDb = (base: string, db: number) => {
  const parsed = new URL(base);
  parsed.pathname = `/${db}`;
  return parsed.toString();
};

async function inRedis<T>(base: string, db: number, work: (c: RedisClient) => Promise<T>) {
  const client = new RedisClient(inDb(base, db));
  try {
    return await work(client);
  } finally {
    client.close();
  }
}

const one = (db: number, keys: string[]) => new Map([[db, keys]]);

describe("leakErrors", () => {
  test("passes when the temp dir is empty and no Redis key is left", () => {
    expect(leakErrors("/t", [], new Map())).toEqual([]);
    expect(leakErrors("/t", [], one(13, []))).toEqual([]);
    expect(leakErrors("/t", [], null)).toEqual([]);
  });

  test("reports every entry left, whatever its name, sorted", () => {
    expect(leakErrors("/t", ["x", "bun-cache", "conveyor-a1"], new Map())).toEqual([
      "the tests left 3 temp entries in /t: bun-cache, conveyor-a1, x",
    ]);
  });

  test("names the Redis keys left, and caps a long list", () => {
    const keys = Array.from({ length: 12 }, (_, i) => `job:${String(i).padStart(2, "0")}:seq`);
    expect(leakErrors("/t", [], one(0, ["jobs:active"]))).toEqual([
      "the tests left 1 Redis keys in db 0: jobs:active",
    ]);
    expect(leakErrors("/t", [], one(0, keys))[0]).toEndWith("job:09:seq, and 2 more");
  });

  test("reports temp entries and Redis keys together", () => {
    expect(leakErrors("/t", ["x"], one(0, ["jobs:active"]))).toHaveLength(2);
  });

  test("reports each db's keys on a line of its own, in db order", () => {
    const keys = new Map([
      [13, ["bull:conveyor-jobs:meta"]],
      [0, ["jobs:active", "job:a:seq"]],
    ]);
    expect(leakErrors("/t", [], keys)).toEqual([
      "the tests left 2 Redis keys in db 0: job:a:seq, jobs:active",
      "the tests left 1 Redis keys in db 13: bull:conveyor-jobs:meta",
    ]);
  });
});

describe("keyspaceDbs", () => {
  test("lists every db INFO keyspace shows with keys", () => {
    const info =
      "# Keyspace\r\ndb0:keys=2,expires=0,avg_ttl=0,subexpiry=0\r\ndb13:keys=1,expires=1,avg_ttl=9\r\n";
    expect(keyspaceDbs(info)).toEqual([0, 13]);
    expect(keyspaceDbs("# Keyspace\r\n")).toEqual([]);
    expect(keyspaceDbs("# Keyspace\r\ndb14:keys=0,expires=0\r\n")).toEqual([]);
  });

  test("refuses a db line it can't read, rather than skipping it", () => {
    expect(() => keyspaceDbs("# Keyspace\r\ndb3:keys=many,expires=0\r\n")).toThrow(
      "can't read this INFO keyspace line: db3:keys=many,expires=0",
    );
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
  if (call.kind === "indirect")
    return `${file}:${call.line}: a mkdtemp name is used other than as a direct call: ${call.ref}`;
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

describe.skipIf(!url)("check:test-leaks on a real Redis", () => {
  test("fails on a key left in db 13, naming the db", async () => {
    const base = url ?? "";
    const tmp = await dirs();
    const key = `leak-probe-${randomUUID()}`;
    await inRedis(base, 13, (c) => c.set(key, "left"));
    try {
      const { code, out } = runCheck(tmp, base);
      expect(code).toBe(1);
      expect(out).toContain(`the tests left 1 Redis keys in db 13: ${key}\n`);
    } finally {
      await inRedis(base, 13, (c) => c.del(key));
    }
  });

  test("passes once keys written to several dbs are gone", async () => {
    const base = url ?? "";
    const tmp = await dirs();
    const key = `clean-probe-${randomUUID()}`;
    for (const db of [0, 13, 14]) await inRedis(base, db, (c) => c.set(key, "x"));
    for (const db of [0, 13, 14]) await inRedis(base, db, (c) => c.del(key));
    expect(runCheck(tmp, base)).toEqual({
      code: 0,
      out: `no test leaks: ${tmp} is empty and no Redis db has keys\n`,
    });
  });
});
