interface LoginLimitOptions {
  maxFailures: number;
  windowMs: number;
  maxClients: number;
  maxTotalFailures: number;
}

const DEFAULT_LOGIN_LIMIT: LoginLimitOptions = {
  maxFailures: 5,
  windowMs: 60_000,
  maxClients: 10_000,
  maxTotalFailures: 100,
};

interface Failures {
  count: number;
  since: number;
}

export interface LoginLimiter {
  retryAfterMs(client: string, now: number): number;
  failed(client: string, now: number): void;
  succeeded(client: string): void;
}

export function loginLimiter(options: LoginLimitOptions = DEFAULT_LOGIN_LIMIT): LoginLimiter {
  const clients = new Map<string, Failures>();
  let total: Failures = { count: 0, since: Number.NEGATIVE_INFINITY };
  const expired = (entry: Failures, now: number) => now - entry.since >= options.windowMs;
  const live = (client: string, now: number): Failures | undefined => {
    const entry = clients.get(client);
    if (entry && expired(entry, now)) {
      clients.delete(client);
      return undefined;
    }
    return entry;
  };
  const wait = (entry: Failures | undefined, max: number, now: number) =>
    entry && entry.count >= max ? entry.since + options.windowMs - now : 0;
  return {
    retryAfterMs(client, now) {
      const overall = wait(total, options.maxTotalFailures, now);
      return Math.max(wait(live(client, now), options.maxFailures, now), overall);
    },
    failed(client, now) {
      if (expired(total, now)) total = { count: 0, since: now };
      total.count++;
      const entry = live(client, now);
      if (entry) {
        entry.count++;
        return;
      }
      if (clients.size >= options.maxClients) {
        const oldest = clients.keys().next().value;
        if (oldest !== undefined) clients.delete(oldest);
      }
      clients.set(client, { count: 1, since: now });
    },
    succeeded(client) {
      clients.delete(client);
    },
  };
}
