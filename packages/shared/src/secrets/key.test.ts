import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import {
  loadSecretsKey,
  parseSecretsKey,
  randomSecretsKey,
  syncDirectoryBestEffort,
} from "./key.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function keyPathInFreshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-key-"));
  dirs.push(dir);
  return join(dir, "secrets.key");
}

const VALID = randomBytes(32).toString("base64");

describe("parseSecretsKey", () => {
  test("accepts 32 bytes of canonical base64", () => {
    expect(parseSecretsKey(VALID)?.bytes.equals(Buffer.from(VALID, "base64"))).toBe(true);
  });

  test.each([
    ["16 bytes", randomBytes(16).toString("base64")],
    ["33 bytes", randomBytes(33).toString("base64")],
    ["hex", randomBytes(32).toString("hex")],
    ["url-safe base64", `${"-".repeat(43)}=`],
    ["surrounding whitespace", ` ${VALID} `],
    ["non-canonical padding bits", `${VALID.slice(0, 42)}B=`],
    ["empty", ""],
  ])("refuses %s", (_label, raw) => {
    expect(parseSecretsKey(raw)).toBeNull();
  });

  test("random keys are 32 bytes and differ", () => {
    const first = randomSecretsKey().bytes;
    expect(first).toHaveLength(32);
    expect(randomSecretsKey().bytes.equals(first)).toBe(false);
  });

  test("serialises and inspects as a placeholder, never as the key bytes", () => {
    const key = parseSecretsKey(VALID);
    expect(JSON.stringify({ key })).toBe('{"key":"[SecretsKey]"}');
    expect(inspect({ key })).toBe("{ key: [SecretsKey] }");
  });
});

describe("loadSecretsKey", () => {
  test("uses CONVEYOR_SECRETS_KEY and writes no file", () => {
    const keyPath = keyPathInFreshDir();
    const result = loadSecretsKey({ CONVEYOR_SECRETS_KEY: VALID }, keyPath);
    expect(result.ok && result.source).toBe("env");
    expect(readdirSync(join(keyPath, ".."))).toEqual([]);
  });

  test("refuses a bad CONVEYOR_SECRETS_KEY without echoing it", () => {
    const bad = "not-a-key-but-a-secret-anyway";
    const result = loadSecretsKey({ CONVEYOR_SECRETS_KEY: bad }, keyPathInFreshDir());
    if (result.ok) throw new Error("bad key accepted");
    expect(result.error.kind).toBe("InvalidSecretsKey");
    expect(result.error.source).toBe("env");
    expect(result.error.message).toContain("CONVEYOR_SECRETS_KEY");
    expect(result.error.message).not.toContain(bad);
  });

  test("generates a key file readable only by its owner when nothing is set", () => {
    const keyPath = keyPathInFreshDir();
    const result = loadSecretsKey({}, keyPath);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.source).toBe("generated");
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(result.key.bytes.toString("base64")).toBe(readFileSync(keyPath, "utf8").trim());
    expect(readdirSync(join(keyPath, ".."))).toEqual(["secrets.key"]);
  });

  test("a directory sync the platform does not support still generates the key at 0600", () => {
    const keyPath = keyPathInFreshDir();
    const unsupported = () => {
      throw Object.assign(new Error("directory sync unsupported"), { code: "EPERM" });
    };
    const result = loadSecretsKey({}, keyPath, unsupported);
    expect(result.ok && result.source).toBe("generated");
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
  });

  test("generating the key syncs its directory exactly once", () => {
    const keyPath = keyPathInFreshDir();
    const synced: string[] = [];
    loadSecretsKey({}, keyPath, (directory) => synced.push(directory));
    loadSecretsKey({}, keyPath, (directory) => synced.push(directory));
    expect(synced).toEqual([join(keyPath, "..")]);
  });

  test("reuses the generated key on the next start", () => {
    const keyPath = keyPathInFreshDir();
    const first = loadSecretsKey({ CONVEYOR_SECRETS_KEY: "" }, keyPath);
    const second = loadSecretsKey({}, keyPath);
    if (!first.ok || !second.ok) throw new Error("key did not load");
    expect(second.source).toBe("file");
    expect(second.key.bytes.equals(first.key.bytes)).toBe(true);
  });

  test("refuses a corrupt key file", () => {
    const keyPath = keyPathInFreshDir();
    writeFileSync(keyPath, "short\n");
    const result = loadSecretsKey({}, keyPath);
    expect(result.ok || result.error.source).toBe("file");
  });

  test("an env key wins over an existing key file", () => {
    const keyPath = keyPathInFreshDir();
    loadSecretsKey({}, keyPath);
    const result = loadSecretsKey({ CONVEYOR_SECRETS_KEY: VALID }, keyPath);
    expect(result.ok && result.key.bytes.toString("base64")).toBe(VALID);
  });
});

describe("syncDirectoryBestEffort", () => {
  const failingWith = (code: string) => () => {
    throw Object.assign(new Error(`directory sync failed: ${code}`), { code });
  };

  test.each(["EISDIR", "EPERM", "EINVAL", "ENOTSUP"])(
    "ignores %s, which means the platform cannot sync a directory",
    (code) => {
      expect(() => syncDirectoryBestEffort(failingWith(code))).not.toThrow();
    },
  );

  test.each(["EIO", "ENOSPC", "ENOENT"])("rethrows %s", (code) => {
    expect(() => syncDirectoryBestEffort(failingWith(code))).toThrow(
      `directory sync failed: ${code}`,
    );
  });

  test("rethrows an error that has no code", () => {
    expect(() =>
      syncDirectoryBestEffort(() => {
        throw new Error("no code");
      }),
    ).toThrow("no code");
  });

  test("runs the sync", () => {
    let calls = 0;
    syncDirectoryBestEffort(() => {
      calls += 1;
    });
    expect(calls).toBe(1);
  });
});
