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

export function keyspaceDbs(info: string): number[] {
  const dbs: number[] = [];
  for (const line of info.split(/\r?\n/)) {
    if (!line.startsWith("db")) continue;
    const match = KEYSPACE_LINE.exec(line);
    if (!match) throw new Error(`can't read this INFO keyspace line: ${line}`);
    if (Number(match[2]) > 0) dbs.push(Number(match[1]));
  }
  return dbs;
}

export const NO_TMPDIR =
  "TMPDIR isn't set: point it at a fresh empty directory before the tests run, so every entry left in it is a leak";

async function send(url: string, command: string, args: string[]): Promise<unknown> {
  const client = new RedisClient(url);
  try {
    return await client.send(command, args);
  } finally {
    client.close();
  }
}

function inDb(url: string, db: number): string {
  const parsed = new URL(url);
  parsed.pathname = `/${db}`;
  return parsed.toString();
}

async function redisKeys(url: string): Promise<DbKeys> {
  const keys: DbKeys = new Map();
  for (const db of keyspaceDbs(String(await send(url, "INFO", ["keyspace"])))) {
    const names = await send(inDb(url, db), "KEYS", ["*"]);
    keys.set(db, Array.isArray(names) ? names.map(String) : []);
  }
  return keys;
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
    console.log(`no test leaks: ${dir} is empty${url ? " and no Redis db has keys" : ""}`);
  process.exit(errors.length === 0 ? 0 : 1);
}
