import { afterAll, beforeAll } from "bun:test";
import { RedisClient } from "bun";

const keysIn = async (client: RedisClient): Promise<string[]> => {
  const keys = await client.send("KEYS", ["*"]);
  return Array.isArray(keys) ? keys.map(String) : [];
};

export function dropsItsRedisKeys(url = process.env.REDIS_URL): void {
  if (!url) return;
  let before = new Set<string>();
  beforeAll(async () => {
    const client = new RedisClient(url);
    try {
      before = new Set(await keysIn(client));
    } finally {
      client.close();
    }
  });
  afterAll(async () => {
    const client = new RedisClient(url);
    try {
      const made = (await keysIn(client)).filter((key) => !before.has(key));
      if (made.length > 0) await client.send("DEL", made);
    } finally {
      client.close();
    }
  });
}
