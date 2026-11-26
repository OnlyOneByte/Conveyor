import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { redisLockStore } from "./printer-lock";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the printer lock tests");

describe.skipIf(!url)("the Redis printer lock", () => {
  const redis = new Redis(url ?? "", { lazyConnect: true });
  const store = redisLockStore(redis);
  const key = () => `printer:test-${randomUUID()}:lock`;
  afterAll(() => redis.quit());

  test("only one token can hold a printer, and only that token renews or releases it", async () => {
    const k = key();
    expect(await store.claim(k, "a", 10_000)).toBe(true);
    expect(await store.claim(k, "b", 10_000)).toBe(false);
    expect(await store.renew(k, "b", 10_000)).toBe(false);
    await store.release(k, "b");
    expect(await redis.get(k)).toBe("a");
    expect(await store.renew(k, "a", 10_000)).toBe(true);
    await store.release(k, "a");
    expect(await redis.get(k)).toBeNull();
  });

  test("a lock nobody renews expires, so a dead worker never holds the printer", async () => {
    const k = key();
    expect(await store.claim(k, "dead", 50)).toBe(true);
    await Bun.sleep(120);
    expect(await store.claim(k, "next", 10_000)).toBe(true);
    await store.release(k, "next");
  });

  test("renewing pushes the expiry out", async () => {
    const k = key();
    await store.claim(k, "a", 100);
    await store.renew(k, "a", 10_000);
    expect(await redis.pttl(k)).toBeGreaterThan(1_000);
    await store.release(k, "a");
  });
});
