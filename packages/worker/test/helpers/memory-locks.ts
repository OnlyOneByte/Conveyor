import type { LockStore } from "../../src/printer-lock";

export function memoryLocks(
  now: () => number = Date.now,
): LockStore & { held: Map<string, string> } {
  const held = new Map<string, string>();
  const until = new Map<string, number>();
  const live = (key: string) => {
    if ((until.get(key) ?? 0) <= now()) {
      held.delete(key);
      until.delete(key);
    }
    return held.get(key);
  };
  return {
    held,
    claim: async (key, token, ttlMs) => {
      if (live(key) !== undefined) return false;
      held.set(key, token);
      until.set(key, now() + ttlMs);
      return true;
    },
    renew: async (key, token, ttlMs) => {
      if (live(key) !== token) return false;
      until.set(key, now() + ttlMs);
      return true;
    },
    release: async (key, token) => {
      if (live(key) === token) {
        held.delete(key);
        until.delete(key);
      }
    },
  };
}
