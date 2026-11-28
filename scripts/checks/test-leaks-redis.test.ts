import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RedisClient } from "bun";
import { tempDirs } from "../../packages/shared/test/helpers/temp.ts";
import { keyspaceCounts, readDbKeys, type Send } from "./test-leaks";

const ROOT = join(import.meta.dir, "..", "..");
const CHECK = join(ROOT, "scripts", "checks", "test-leaks.ts");
const dirs = tempDirs("conveyor-leaks-");

const runCheck = (tmp: string, redisUrl: string) => {
  const env = { ...process.env, TMPDIR: tmp, REDIS_URL: redisUrl };
  const run = Bun.spawnSync([process.execPath, CHECK], { cwd: ROOT, env });
  return { code: run.exitCode, out: `${run.stdout}${run.stderr}` };
};

const url = process.env.REDIS_URL;
const PROBE_DB = 15;

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

const INFO =
  "# Keyspace\r\ndb0:keys=2,expires=0,avg_ttl=0,subexpiry=0\r\ndb13:keys=1,expires=1,avg_ttl=9\r\n";

describe("keyspaceCounts", () => {
  test("counts the keys of every db INFO keyspace shows with keys", () => {
    expect([...keyspaceCounts(INFO)]).toEqual([
      [0, 2],
      [13, 1],
    ]);
    expect([...keyspaceCounts("# Keyspace\r\n")]).toEqual([]);
    expect([...keyspaceCounts("# Keyspace\r\ndb14:keys=0,expires=0\r\n")]).toEqual([]);
  });

  test("refuses a db line it can't read, rather than skipping it", () => {
    expect(() => keyspaceCounts("# Keyspace\r\ndb3:keys=many,expires=0\r\n")).toThrow(
      "can't read this INFO keyspace line: db3:keys=many,expires=0",
    );
  });

  test.each([
    [""],
    ["# Server\r\nredis_version:8.0.0\r\n"],
    [null],
    [undefined],
    [42],
    [[INFO]],
    [Buffer.from(INFO)],
  ])("refuses a reply with no # Keyspace section: %p", (reply) => {
    expect(() => keyspaceCounts(reply)).toThrow("INFO keyspace gave a reply this check can't read");
  });
});

const fakeRedis = (dbs: Record<number, unknown>, info: unknown = INFO) => {
  const sent: string[] = [];
  let selected = 0;
  const send: Send = async (command, args) => {
    sent.push([command, ...args].join(" "));
    if (command === "INFO") return info;
    if (command === "SELECT") selected = Number(args[0]);
    if (command === "KEYS") return dbs[selected];
    return "OK";
  };
  return { send, sent };
};

describe("readDbKeys", () => {
  test("selects each db on the one connection before listing its keys", async () => {
    const redis = fakeRedis({ 0: ["a", "b"], 13: ["c"] });
    expect([...(await readDbKeys(redis.send))]).toEqual([
      [0, ["a", "b"]],
      [13, ["c"]],
    ]);
    expect(redis.sent).toEqual(["INFO keyspace", "SELECT 0", "KEYS *", "SELECT 13", "KEYS *"]);
  });

  test("fails, naming INFO's count, when KEYS lists fewer keys than INFO counts", async () => {
    const redis = fakeRedis({ 0: ["a", "b"], 13: [] });
    await expect(readDbKeys(redis.send)).rejects.toThrow(
      "INFO counts 1 keys in db 13 but KEYS lists 0; keys may have expired or leaked",
    );
  });

  test("fails when KEYS doesn't answer with a list", async () => {
    const redis = fakeRedis({ 0: "a b" });
    await expect(readDbKeys(redis.send)).rejects.toThrow('KEYS in db 0 gave "a b", not a list');
  });

  test("fails on an INFO reply it can't read", async () => {
    await expect(readDbKeys(fakeRedis({}, "").send)).rejects.toThrow(
      "INFO keyspace gave a reply this check can't read",
    );
  });
});

test("the probe db is one no other test file selects", () => {
  const files = Bun.spawnSync(["git", "ls-files", "-z", "*.test.ts"], { cwd: ROOT })
    .stdout.toString()
    .split("\0")
    .filter((file) => file && !file.endsWith("scripts/checks/test-leaks-redis.test.ts"));
  const taken = files.flatMap((file) =>
    [...readFileSync(join(ROOT, file), "utf8").matchAll(/ISOLATED_DB = "?(\d+)"?/g)].map((m) =>
      Number(m[1]),
    ),
  );
  expect(taken.length).toBeGreaterThan(0);
  expect(taken).not.toContain(PROBE_DB);
});

describe.skipIf(!url)("check:test-leaks on a real Redis", () => {
  test("fails on a key left in a db other than 0, naming the db", async () => {
    const base = url ?? "";
    const tmp = await dirs();
    const key = `leak-probe-${randomUUID()}`;
    await inRedis(base, PROBE_DB, (c) => c.set(key, "left"));
    try {
      const { code, out } = runCheck(tmp, base);
      expect(code).toBe(1);
      expect(out).toContain(`the tests left 1 Redis keys in db ${PROBE_DB}: ${key}\n`);
    } finally {
      await inRedis(base, PROBE_DB, (c) => c.del(key));
    }
  });

  test("passes once keys written to several dbs are gone", async () => {
    const base = url ?? "";
    const tmp = await dirs();
    const key = `clean-probe-${randomUUID()}`;
    for (const db of [0, PROBE_DB]) await inRedis(base, db, (c) => c.set(key, "x"));
    for (const db of [0, PROBE_DB]) await inRedis(base, db, (c) => c.del(key));
    expect(runCheck(tmp, base)).toEqual({
      code: 0,
      out: `no test leaks: ${tmp} is empty and no Redis db has keys\n`,
    });
  });
});

type Reply = (command: string) => string | null;

function fakeServer(reply: Reply) {
  return Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket, data) {
        const command = /\$\d+\r\n([A-Za-z]+)/.exec(data.toString())?.[1]?.toUpperCase() ?? "";
        const answer =
          command === "HELLO" ? "%1\r\n$6\r\nserver\r\n$5\r\nredis\r\n" : reply(command);
        if (answer !== null) socket.write(answer);
      },
    },
  });
}

const bulk = (text: string) => `$${text.length}\r\n${text}\r\n`;

async function checkAgainst(redisUrl: string) {
  const tmp = await dirs();
  const started = Date.now();
  const run = Bun.spawn([process.execPath, CHECK], {
    cwd: ROOT,
    env: { ...process.env, TMPDIR: tmp, REDIS_URL: redisUrl },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = (await new Response(run.stdout).text()) + (await new Response(run.stderr).text());
  return { code: await run.exited, out, took: Date.now() - started };
}

describe("check:test-leaks when Redis can't be read", () => {
  test("exits 1, never a clean pass, when INFO has no # Keyspace section", async () => {
    const server = fakeServer((command) =>
      command === "INFO" ? bulk("# Server\r\nredis_version:8.0.0\r\n") : "+OK\r\n",
    );
    try {
      const { code, out } = await checkAgainst(`redis://127.0.0.1:${server.port}`);
      expect(code).toBe(1);
      expect(out).toContain(
        "check:test-leaks couldn't read Redis: INFO keyspace gave a reply this check can't read",
      );
      expect(out).not.toContain("no test leaks");
    } finally {
      server.stop(true);
    }
  });

  test("exits 1 within about 5 s when Redis accepts the connection but never answers", async () => {
    const server = fakeServer(() => null);
    try {
      const { code, out, took } = await checkAgainst(`redis://127.0.0.1:${server.port}`);
      expect(code).toBe(1);
      expect(out).toContain(
        "check:test-leaks couldn't read Redis: Redis didn't answer within 5000 ms",
      );
      expect(took).toBeLessThan(9000);
    } finally {
      server.stop(true);
    }
  }, 20_000);

  test("exits 1 at once when nothing listens on the Redis port", async () => {
    const server = fakeServer(() => null);
    const port = server.port;
    server.stop(true);
    const { code, out, took } = await checkAgainst(`redis://127.0.0.1:${port}`);
    expect(code).toBe(1);
    expect(out).toContain("check:test-leaks couldn't read Redis");
    expect(took).toBeLessThan(5000);
  }, 20_000);
});
