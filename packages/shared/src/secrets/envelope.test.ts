import { describe, expect, test } from "bun:test";
import { isEnvelope, openSecret, sealSecret } from "./envelope.ts";
import { randomSecretsKey } from "./key.ts";

const key = randomSecretsKey();
const SECRET = '{"apiKey":"moonraker-key-123"}';

function flipFirstByte(base64: string): string {
  const bytes = Buffer.from(base64, "base64");
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return bytes.toString("base64");
}

function tamper(sealed: string, index: 1 | 2 | 3): string {
  const parts = sealed.split(":");
  parts[index] = flipFirstByte(parts[index] ?? "");
  return parts.join(":");
}

describe("sealSecret and openSecret", () => {
  test("a sealed secret opens back to the same plaintext", () => {
    expect(openSecret(key, sealSecret(key, SECRET, "printer:a"), "printer:a")).toEqual({
      ok: true,
      value: SECRET,
    });
  });

  test("the envelope is v1 with a 12-byte iv, a 16-byte tag and no plaintext", () => {
    const sealed = sealSecret(key, SECRET, "printer:a");
    const [version, iv, tag] = sealed.split(":");
    expect(version).toBe("v1");
    expect(Buffer.from(iv ?? "", "base64")).toHaveLength(12);
    expect(Buffer.from(tag ?? "", "base64")).toHaveLength(16);
    expect(sealed).not.toContain("moonraker-key-123");
    expect(isEnvelope(sealed)).toBe(true);
  });

  test("two seals of the same plaintext use different ivs", () => {
    const first = sealSecret(key, SECRET, "printer:a").split(":")[1];
    const second = sealSecret(key, SECRET, "printer:a").split(":")[1];
    expect(first).not.toBe(second);
  });

  test.each([1, 2, 3] as const)("a change to part %i of the envelope is refused", (index) => {
    const tampered = tamper(sealSecret(key, SECRET, "printer:a"), index);
    expect(openSecret(key, tampered, "printer:a")).toEqual({
      ok: false,
      error: { kind: "Undecryptable" },
    });
  });

  test("a wrong key is refused", () => {
    expect(
      openSecret(randomSecretsKey(), sealSecret(key, SECRET, "printer:a"), "printer:a"),
    ).toEqual({
      ok: false,
      error: { kind: "Undecryptable" },
    });
  });

  test("a secret sealed for one context does not open in another", () => {
    expect(openSecret(key, sealSecret(key, SECRET, "printer:a"), "printer:b")).toEqual({
      ok: false,
      error: { kind: "Undecryptable" },
    });
  });

  test.each([
    ["plaintext json", SECRET],
    ["an unknown version", sealSecret(key, SECRET, "printer:a").replace(/^v1/, "v2")],
    ["a missing part", "v1:aaaa:bbbb"],
    ["an extra part", `${sealSecret(key, SECRET, "printer:a")}:extra`],
    ["a short iv", "v1:AAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA"],
    ["a short tag", "v1:AAAAAAAAAAAAAAAA:AAAA:AAAA"],
  ])("%s is not an envelope", (_label, stored) => {
    expect(openSecret(key, stored, "printer:a")).toEqual({
      ok: false,
      error: { kind: "NotAnEnvelope" },
    });
  });

  test("isEnvelope tells plaintext from an envelope", () => {
    expect(isEnvelope(SECRET)).toBe(false);
    expect(isEnvelope("v1:")).toBe(true);
  });
});
