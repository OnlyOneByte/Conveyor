import { randomBytes } from "node:crypto";
import { linkSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

export const SECRETS_KEY_BYTES = 32;
const HIDDEN = "[SecretsKey]";

export interface SecretsKey {
  readonly bytes: Buffer;
}

export type KeySource = "env" | "file";

export type KeyResult =
  | { ok: true; key: SecretsKey; source: KeySource | "generated" }
  | { ok: false; error: { kind: "InvalidSecretsKey"; source: KeySource; message: string } };

function hiddenKey(bytes: Buffer): SecretsKey {
  return Object.freeze({
    bytes,
    toJSON: () => HIDDEN,
    [Symbol.for("nodejs.util.inspect.custom")]: () => HIDDEN,
  });
}

export function randomSecretsKey(): SecretsKey {
  return hiddenKey(randomBytes(SECRETS_KEY_BYTES));
}

export function parseSecretsKey(raw: string): SecretsKey | null {
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== SECRETS_KEY_BYTES || bytes.toString("base64") !== raw) return null;
  return hiddenKey(bytes);
}

function invalid(source: KeySource, where: string): KeyResult {
  return {
    ok: false,
    error: {
      kind: "InvalidSecretsKey",
      source,
      message: `${where} must be exactly ${SECRETS_KEY_BYTES} bytes in canonical base64 (try \`openssl rand -base64 32\`)`,
    },
  };
}

function isAlreadyThere(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "EEXIST";
}

function createUnlessPresent(keyPath: string): boolean {
  const draft = `${keyPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(draft, `${randomSecretsKey().bytes.toString("base64")}\n`, { mode: 0o600 });
  try {
    linkSync(draft, keyPath);
    return true;
  } catch (err) {
    if (isAlreadyThere(err)) return false;
    throw err;
  } finally {
    unlinkSync(draft);
  }
}

export function loadSecretsKey(
  env: Record<string, string | undefined>,
  keyPath: string,
): KeyResult {
  const fromEnv = env.CONVEYOR_SECRETS_KEY;
  if (fromEnv !== undefined && fromEnv !== "") {
    const key = parseSecretsKey(fromEnv);
    return key ? { ok: true, key, source: "env" } : invalid("env", "CONVEYOR_SECRETS_KEY");
  }
  const created = createUnlessPresent(keyPath);
  const key = parseSecretsKey(readFileSync(keyPath, "utf8").trim());
  if (!key) return invalid("file", keyPath);
  return { ok: true, key, source: created ? "generated" : "file" };
}
