import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SecretsKey } from "./key.ts";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

type OpenError = { kind: "NotAnEnvelope" } | { kind: "Undecryptable" };

type OpenResult = { ok: true; value: string } | { ok: false; error: OpenError };

export function isEnvelope(stored: string): boolean {
  return stored.startsWith(`${ENVELOPE_VERSION}:`);
}

export function sealSecret(key: SecretsKey, plaintext: string, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key.bytes, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64"));
  return [ENVELOPE_VERSION, ...parts].join(":");
}

export function openSecret(key: SecretsKey, stored: string, context: string): OpenResult {
  const [version, iv, tag, ciphertext, ...rest] = stored.split(":");
  if (version !== ENVELOPE_VERSION || ciphertext === undefined || rest.length > 0) {
    return { ok: false, error: { kind: "NotAnEnvelope" } };
  }
  const ivBytes = Buffer.from(iv ?? "", "base64");
  const tagBytes = Buffer.from(tag ?? "", "base64");
  if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) {
    return { ok: false, error: { kind: "NotAnEnvelope" } };
  }
  return decrypt(key, { iv: ivBytes, tag: tagBytes, ciphertext, context });
}

function decrypt(
  key: SecretsKey,
  sealed: { iv: Buffer; tag: Buffer; ciphertext: string; context: string },
): OpenResult {
  const decipher = createDecipheriv(ALGORITHM, key.bytes, sealed.iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(sealed.context, "utf8"));
  decipher.setAuthTag(sealed.tag);
  try {
    const body = Buffer.from(sealed.ciphertext, "base64");
    const plaintext = Buffer.concat([decipher.update(body), decipher.final()]);
    return { ok: true, value: plaintext.toString("utf8") };
  } catch {
    return { ok: false, error: { kind: "Undecryptable" } };
  }
}
