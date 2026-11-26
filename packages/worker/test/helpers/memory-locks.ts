import type { LockStore } from "../../src/printer-lock";

export type MemoryLocks = LockStore & {
  held: Map<string, string>;
  failRenewalsOf: string | undefined;
};

export function memoryLocks(now: () => number = Date.now): MemoryLocks {
  const held = new Map<string, string>();
  const until = new Map<string, number>();
  const live = (key: string) => {
    if ((until.get(key) ?? 0) <= now()) {
      held.delete(key);
      until.delete(key);
    }
    return held.get(key);
  };
  const store: MemoryLocks = {
    held,
    failRenewalsOf: undefined,
    claim: async (key: string, token: string, ttlMs: number) => {
      if (live(key) !== undefined) return false;
      held.set(key, token);
      until.set(key, now() + ttlMs);
      return true;
    },
    renew: async (key: string, token: string, ttlMs: number) => {
      if (token === store.failRenewalsOf) throw new Error("redis connection lost");
      if (live(key) !== token) return false;
      until.set(key, now() + ttlMs);
      return true;
    },
    release: async (key: string, token: string) => {
      if (live(key) === token) {
        held.delete(key);
        until.delete(key);
      }
    },
  };
  return store;
}
