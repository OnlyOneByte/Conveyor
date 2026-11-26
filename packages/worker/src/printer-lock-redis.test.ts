import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { PrintStatus } from "@conveyor/shared";
import Redis from "ioredis";
import { harness } from "../test/helpers/pipeline-harness";
import { printerLock, redisLockStore } from "./printer-lock";

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

  test("two pipelines on one printer take turns on a real Redis lock", async () => {
    const lock = printerLock(store, { held: () => null, log: () => {}, pollMs: 5 });
    const started: string[] = [];
    let active = 0;
    let most = 0;
    let finishFirst = () => {};
    const firstMayFinish = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const pipeline = (name: string) => {
      async function* status(): AsyncIterable<PrintStatus> {
        yield { state: "printing", progress: 0.5 };
        if (name === "a") await firstMayFinish;
        active--;
        yield { state: "done" };
      }
      return harness({
        submit: async (ctx) => {
          await ctx.confirmStart?.();
          active++;
          most = Math.max(most, active);
          started.push(name);
        },
        status,
        deps: () => ({ printerLock: lock }),
      });
    };
    const first = pipeline("a").run();
    for (let tries = 0; tries < 200 && started.length === 0; tries++) await Bun.sleep(5);
    const second = pipeline("b").run();
    await Bun.sleep(80);
    expect(started).toEqual(["a"]);
    finishFirst();
    expect(await first).toBe("done");
    expect(await second).toBe("done");
    expect(started).toEqual(["a", "b"]);
    expect(most).toBe(1);
  });
});
