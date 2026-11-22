export interface LoginLimitOptions {
  maxFailures: number;
  windowMs: number;
  maxClients: number;
}

export const DEFAULT_LOGIN_LIMIT: LoginLimitOptions = {
  maxFailures: 5,
  windowMs: 60_000,
  maxClients: 10_000,
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
  const live = (client: string, now: number): Failures | undefined => {
    const entry = clients.get(client);
    if (entry && now - entry.since >= options.windowMs) {
      clients.delete(client);
      return undefined;
    }
    return entry;
  };
  return {
    retryAfterMs(client, now) {
      const entry = live(client, now);
      if (!entry || entry.count < options.maxFailures) return 0;
      return entry.since + options.windowMs - now;
    },
    failed(client, now) {
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
