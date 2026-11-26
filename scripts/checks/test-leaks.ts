import { readdirSync } from "node:fs";
import { RedisClient } from "bun";

const SHOWN = 10;

const listed = (names: string[]) =>
  `${names.slice(0, SHOWN).join(", ")}${names.length > SHOWN ? `, and ${names.length - SHOWN} more` : ""}`;

export function leakErrors(dir: string, entries: string[], keys: string[] | null): string[] {
  const errors: string[] = [];
  const left = [...entries].sort();
  if (left.length > 0)
    errors.push(`the tests left ${left.length} temp entries in ${dir}: ${listed(left)}`);
  const kept = [...(keys ?? [])].sort();
  if (kept.length > 0) errors.push(`the tests left ${kept.length} Redis keys: ${listed(kept)}`);
  return errors;
}

export const NO_TMPDIR =
  "TMPDIR isn't set: point it at a fresh empty directory before the tests run, so every entry left in it is a leak";

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
  const dir = process.env.TMPDIR;
  if (!dir) {
    console.error(NO_TMPDIR);
    process.exit(1);
  }
  const url = process.env.REDIS_URL;
  const errors = leakErrors(dir, readdirSync(dir), url ? await redisKeys(url) : null);
  for (const error of errors) console.error(error);
  if (errors.length === 0)
    console.log(`no test leaks: ${dir} is empty${url ? " and Redis has no keys" : ""}`);
  process.exit(errors.length === 0 ? 0 : 1);
}
