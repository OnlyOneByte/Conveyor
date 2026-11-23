import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-auth-"));
const keys = ["CONVEYOR_AUTH", "CONVEYOR_PASSWORD", "CONVEYOR_AUTH_SECRET", "DB_PATH", "DATA_DIR"];
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  CONVEYOR_AUTH: "enabled",
  CONVEYOR_PASSWORD: "auth-unit-test-password",
  CONVEYOR_AUTH_SECRET: "auth-unit-test-secret-auth-unit-test-secret",
  DB_PATH: join(dir, "conveyor.db"),
  DATA_DIR: dir,
});
const auth = await import("./auth");

afterAll(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("session tokens", () => {
  test("an issued token verifies until it is revoked", () => {
    const token = auth.issueToken();
    expect(auth.verifyToken(token)).toBe(true);
    auth.revokeToken(token);
    expect(auth.verifyToken(token)).toBe(false);
  });

  test("revoking one token leaves another valid", () => {
    const kept = auth.issueToken();
    auth.revokeToken(auth.issueToken());
    expect(auth.verifyToken(kept)).toBe(true);
  });

  test.each([
    ["no token", undefined],
    ["no signature", "abc"],
    ["a bad signature", `${Buffer.from('{"exp":1}').toString("base64url")}.bad`],
  ])("refuses %s, and revoking it does nothing", (_label, token) => {
    expect(auth.verifyToken(token)).toBe(false);
    auth.revokeToken(token);
  });

  test("refuses a token whose payload was edited after signing", () => {
    const [data, sig] = auth.issueToken().split(".");
    const payload = JSON.parse(Buffer.from(data ?? "", "base64url").toString());
    const edited = Buffer.from(JSON.stringify({ ...payload, exp: payload.exp + 1 })).toString(
      "base64url",
    );
    expect(auth.verifyToken(`${edited}.${sig}`)).toBe(false);
  });
});

describe("passwords and cookies", () => {
  test("checks the configured password only", () => {
    expect(auth.checkPassword("auth-unit-test-password")).toBe(true);
    expect(auth.checkPassword("auth-unit-test-passwore")).toBe(false);
  });

  test("the session cookie is HttpOnly, SameSite=Strict and Secure, and reads back", () => {
    const cookie = auth.sessionCookie("tok.sig");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(auth.readSessionCookie(`a=1; ${cookie.split(";")[0]}; b=2`)).toBe("tok.sig");
    expect(auth.readSessionCookie(undefined)).toBeUndefined();
    expect(auth.clearCookie()).toContain("Max-Age=0");
  });
});
