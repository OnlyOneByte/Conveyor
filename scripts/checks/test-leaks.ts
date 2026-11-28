import { readdirSync } from "node:fs";
import { RedisClient } from "bun";

const SHOWN = 10;

const listed = (names: string[]) =>
  `${names.slice(0, SHOWN).join(", ")}${names.length > SHOWN ? `, and ${names.length - SHOWN} more` : ""}`;

export type DbKeys = Map<number, string[]>;

export function leakErrors(dir: string, entries: string[], keys: DbKeys | null): string[] {
  const errors: string[] = [];
  const left = [...entries].sort();
  if (left.length > 0)
    errors.push(`the tests left ${left.length} temp entries in ${dir}: ${listed(left)}`);
  for (const [db, names] of [...(keys ?? [])].sort(([a], [b]) => a - b)) {
    const kept = [...names].sort();
    if (kept.length > 0)
      errors.push(`the tests left ${kept.length} Redis keys in db ${db}: ${listed(kept)}`);
  }
  return errors;
}

const KEYSPACE_LINE = /^db(\d+):keys=(\d+),/;

export function keyspaceCounts(info: unknown): Map<number, number> {
  if (typeof info !== "string" || !info.includes("# Keyspace"))
    throw new Error(`INFO keyspace gave a reply this check can't read: ${JSON.stringify(info)}`);
  const counts = new Map<number, number>();
  for (const line of info.split(/\r?\n/)) {
    if (!line.startsWith("db")) continue;
    const match = KEYSPACE_LINE.exec(line);
    if (!match) throw new Error(`can't read this INFO keyspace line: ${line}`);
    if (Number(match[2]) > 0) counts.set(Number(match[1]), Number(match[2]));
  }
  return counts;
}

export type Send = (command: string, args: string[]) => Promise<unknown>;

export async function readDbKeys(send: Send): Promise<DbKeys> {
  const keys: DbKeys = new Map();
  for (const [db, count] of keyspaceCounts(await send("INFO", ["keyspace"]))) {
    await send("SELECT", [String(db)]);
    const names = await send("KEYS", ["*"]);
    if (!Array.isArray(names) || names.length < count)
      throw new Error(
        `INFO keyspace counts ${count} keys in db ${db}, but KEYS gave ${Array.isArray(names) ? names.length : JSON.stringify(names)}`,
      );
    keys.set(db, names.map(String));
  }
  return keys;
}

export const NO_TMPDIR =
  "TMPDIR isn't set: point it at a fresh empty directory before the tests run, so every entry left in it is a leak";

async function redisKeys(url: string): Promise<DbKeys> {
  const client = new RedisClient(url);
  try {
    return await readDbKeys((command, args) => client.send(command, args));
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
  const keys = url
    ? await redisKeys(url).catch((err: unknown) => {
        console.error(
          `check:test-leaks couldn't read Redis: ${err instanceof Error ? err.message : err}`,
        );
        process.exit(1);
      })
    : null;
  const errors = leakErrors(dir, readdirSync(dir), keys);
  for (const error of errors) console.error(error);
  if (errors.length === 0)
    console.log(`no test leaks: ${dir} is empty${url ? " and no Redis db has keys" : ""}`);
  process.exit(errors.length === 0 ? 0 : 1);
}
