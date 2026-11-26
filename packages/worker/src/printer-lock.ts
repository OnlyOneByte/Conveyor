import { randomUUID } from "node:crypto";
import { PrintNotStartedError, StageError } from "@conveyor/shared";
import { JobCanceledError } from "./run.js";

export const PRINTER_LOCK_TTL_MS = 60_000;
export const PRINTER_LOCK_POLL_MS = 2_000;

export interface LockStore {
  claim(key: string, token: string, ttlMs: number): Promise<boolean>;
  renew(key: string, token: string, ttlMs: number): Promise<boolean>;
  release(key: string, token: string): Promise<void>;
}

interface RedisCommands {
  set(key: string, value: string, px: "PX", ttl: number, nx: "NX"): Promise<string | null>;
  eval(script: string, keys: number, ...args: (string | number)[]): Promise<unknown>;
}

const RENEW = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) end return 0`;
const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0`;

export function redisLockStore(redis: RedisCommands): LockStore {
  return {
    claim: async (key, token, ttlMs) => (await redis.set(key, token, "PX", ttlMs, "NX")) === "OK",
    renew: async (key, token, ttlMs) => (await redis.eval(RENEW, 1, key, token, ttlMs)) === 1,
    release: async (key, token) => {
      await redis.eval(RELEASE, 1, key, token);
    },
  };
}

export interface HeldPrinter {
  confirm(): Promise<void>;
  release(): Promise<void>;
}

export const LOCK_LOST =
  "the printer lock was lost before the print started, so nothing was started";

export interface PrinterLock {
  acquire(printerId: string, signal: AbortSignal): Promise<HeldPrinter>;
}

export interface PrinterLockOptions {
  held: (printerId: string) => string | null;
  log: (message: string) => void;
  ttlMs?: number;
  pollMs?: number;
  now?: () => number;
}

export const printerLockKey = (printerId: string) => `printer:${printerId}:lock`;

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

export function printerLock(store: LockStore, options: PrinterLockOptions): PrinterLock {
  const ttlMs = options.ttlMs ?? PRINTER_LOCK_TTL_MS;
  const pollMs = options.pollMs ?? PRINTER_LOCK_POLL_MS;
  const now = options.now ?? Date.now;
  return {
    async acquire(printerId, signal) {
      const key = printerLockKey(printerId);
      const token = randomUUID();
      for (let waiting = false; ; waiting = true) {
        if (signal.aborted) throw new JobCanceledError();
        const hold = options.held(printerId);
        if (hold !== null) throw new StageError("transport", `printer is on hold: ${hold}`);
        if (await store.claim(key, token, ttlMs)) break;
        if (!waiting) options.log(`printer ${printerId} is busy with another job; waiting for it`);
        await pause(pollMs, signal);
      }
      let lost = false;
      let renewedAt = now();
      const lose = (why: string) => {
        if (!lost) options.log(`printer ${printerId} lock lost: ${why}`);
        lost = true;
      };
      const renewNow = async () => {
        const startedAt = now();
        const kept = await store.renew(key, token, ttlMs).catch((err: unknown) => {
          lose(`not renewed: ${err instanceof Error ? err.message : String(err)}`);
          return false;
        });
        if (!kept) return lose("another job holds it now, or it expired");
        renewedAt = startedAt;
      };
      const renew = setInterval(() => void renewNow(), ttlMs / 3);
      return {
        async confirm() {
          if (!lost && now() - renewedAt >= ttlMs) lose(`no renewal for ${ttlMs} ms`);
          if (!lost) await renewNow();
          if (lost) throw new PrintNotStartedError(LOCK_LOST);
        },
        async release() {
          clearInterval(renew);
          await store
            .release(key, token)
            .catch((err: unknown) =>
              options.log(
                `printer ${printerId} lock not released: ${err instanceof Error ? err.message : String(err)}`,
              ),
            );
        },
      };
    },
  };
}
