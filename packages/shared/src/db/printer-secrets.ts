import type { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { isEnvelope, openSecret, sealSecret } from "../secrets/envelope.ts";
import { loadSecretsKey, randomSecretsKey, type SecretsKey } from "../secrets/key.ts";

const KEY_CHECK = "secrets_key_check";
const KEY_CHECK_PLAINTEXT = "conveyor-secrets-key-check";
const SecretsRecord = z.record(z.string());
const keys = new WeakMap<Database, SecretsKey>();

export type PrinterSecretsResult =
  | { ok: true; value: Record<string, string> | undefined }
  | { ok: false; error: { kind: "PrinterSecretsUnreadable"; printerId: string } };

export class SecretsKeyError extends Error {
  override name = "SecretsKeyError";
}

export function resolveSecretsKey(
  dbPath: string,
  env: Record<string, string | undefined>,
): SecretsKey {
  if (dbPath === ":memory:" && !env.CONVEYOR_SECRETS_KEY) return randomSecretsKey();
  const keyPath = join(dirname(dbPath), "secrets.key");
  const result = loadSecretsKey(env, keyPath);
  if (!result.ok) throw new SecretsKeyError(`[secrets] refusing to start: ${result.error.message}`);
  if (result.source === "generated") console.log(`[secrets] generated a new key at ${keyPath}`);
  if (result.source === "file" && (statSync(keyPath).mode & 0o077) !== 0) {
    console.warn(`[secrets] ${keyPath} is open to other users; run chmod 600 on it`);
  }
  return result.key;
}

export function bindSecretsKey(db: Database, key: SecretsKey): void {
  keys.set(db, key);
}

function keyOf(db: Database): SecretsKey {
  const key = keys.get(db);
  if (!key) throw new SecretsKeyError("[secrets] no key is bound to this database");
  return key;
}

const contextOf = (printerId: string) => `printers.secrets_json:${printerId}`;

export function sealPrinterSecrets(
  db: Database,
  printerId: string,
  secrets: Record<string, string>,
): string {
  return sealSecret(keyOf(db), JSON.stringify(secrets), contextOf(printerId));
}

export function dbGetPrinterSecrets(db: Database, printerId: string): PrinterSecretsResult {
  const row = db
    .query<{ secrets_json: string | null }, [string]>(
      "SELECT secrets_json FROM printers WHERE id = ?",
    )
    .get(printerId);
  if (!row?.secrets_json) return { ok: true, value: undefined };
  const opened = openSecret(keyOf(db), row.secrets_json, contextOf(printerId));
  const secrets = opened.ok ? parseSecretsRecord(opened.value) : undefined;
  if (!secrets) return { ok: false, error: { kind: "PrinterSecretsUnreadable", printerId } };
  return { ok: true, value: secrets };
}

function parseSecretsRecord(text: string): Record<string, string> | undefined {
  try {
    return SecretsRecord.safeParse(JSON.parse(text)).data;
  } catch {
    return undefined;
  }
}

function verifyKeyCheck(key: SecretsKey, stored: string): void {
  if (openSecret(key, stored, KEY_CHECK).ok) return;
  throw new SecretsKeyError(
    "[secrets] refusing to start: this database's printer secrets were encrypted with a different key. Restore the original CONVEYOR_SECRETS_KEY or secrets.key; see docs/self-hosting.md.",
  );
}

export function encryptPlaintextSecrets(db: Database): void {
  const key = keyOf(db);
  const check = db
    .query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?")
    .get(KEY_CHECK);
  if (check) {
    verifyKeyCheck(key, check.value);
    return;
  }
  const rows = db
    .query<{ id: string; secrets_json: string }, []>(
      "SELECT id, secrets_json FROM printers WHERE secrets_json IS NOT NULL",
    )
    .all();
  const update = db.prepare("UPDATE printers SET secrets_json = ? WHERE id = ?");
  for (const row of rows.filter((r) => !isEnvelope(r.secrets_json))) {
    update.run(sealSecret(key, row.secrets_json, contextOf(row.id)), row.id);
  }
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
    KEY_CHECK,
    sealSecret(key, KEY_CHECK_PLAINTEXT, KEY_CHECK),
  );
}
