import { randomUUID } from "node:crypto";
import { StageError } from "@conveyor/shared";
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
  release(): Promise<void>;
}

export interface PrinterLock {
  acquire(printerId: string, signal: AbortSignal): Promise<HeldPrinter>;
}

export interface PrinterLockOptions {
  held: (printerId: string) => string | null;
  log: (message: string) => void;
  ttlMs?: number;
  pollMs?: number;
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
      const renew = setInterval(() => {
        void store
          .renew(key, token, ttlMs)
          .then((kept) => {
            if (!kept) options.log(`printer ${printerId} lock was lost before the print settled`);
          })
          .catch((err: unknown) =>
            options.log(
              `printer ${printerId} lock not renewed: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
      }, ttlMs / 3);
      return {
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
