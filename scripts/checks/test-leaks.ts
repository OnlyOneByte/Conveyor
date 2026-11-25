import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { RedisClient } from "bun";
import { TEMP_PREFIXES, watchedPrefix } from "../../packages/shared/test/helpers/temp-prefixes.ts";

const SHOWN = 10;
const PREFIXES = TEMP_PREFIXES.map((prefix) => `${prefix}*`).join(", ");

const listed = (names: string[]) =>
  `${names.slice(0, SHOWN).join(", ")}${names.length > SHOWN ? `, and ${names.length - SHOWN} more` : ""}`;

export function leakErrors(dir: string, entries: string[], keys: string[] | null): string[] {
  const errors: string[] = [];
  const left = entries.filter(watchedPrefix).sort();
  if (left.length > 0)
    errors.push(`the tests left ${left.length} temp entries in ${dir}: ${listed(left)}`);
  const kept = [...(keys ?? [])].sort();
  if (kept.length > 0) errors.push(`the tests left ${kept.length} Redis keys: ${listed(kept)}`);
  return errors;
}

async function redisKeys(url: string): Promise<string[]> {
  const client = new RedisClient(url);
  try {
    const keys = await client.send("KEYS", ["*"]);
    return Array.isArray(keys) ? keys.map(String) : [];
  } finally {
    client.close();
  }
}

if (import.meta.main) {
  const dir = tmpdir();
  const url = process.env.REDIS_URL;
  const errors = leakErrors(dir, readdirSync(dir), url ? await redisKeys(url) : null);
  for (const error of errors) console.error(error);
  if (errors.length === 0)
    console.log(
      `no test leaks: no ${PREFIXES} entries in ${dir}${url ? " and no Redis keys" : ""}`,
    );
  process.exit(errors.length === 0 ? 0 : 1);
}
