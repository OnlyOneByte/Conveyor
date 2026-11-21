import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { AuthConfigError, DISABLED_WARNING, resolveAuthConfig } from "./auth-config";

const SECRET = "a".repeat(64);
const PASSWORD = "correct-horse-battery";
const random = () => "random-secret";
const resolve = (env: Record<string, string>) => resolveAuthConfig(env, random);
const withAuth = (overrides: Record<string, string>) =>
  resolve({ CONVEYOR_PASSWORD: PASSWORD, CONVEYOR_AUTH_SECRET: SECRET, ...overrides });

describe("resolveAuthConfig", () => {
  test("refuses to start with no password and no secret", () => {
    expect(() => resolve({})).toThrow(
      /refusing to start: CONVEYOR_PASSWORD and CONVEYOR_AUTH_SECRET not set/,
    );
  });

  test("refuses to start with a password but no secret", () => {
    expect(() => resolve({ CONVEYOR_PASSWORD: PASSWORD })).toThrow(
      /refusing to start: CONVEYOR_AUTH_SECRET not set/,
    );
  });

  test("refuses to start with a secret but no password", () => {
    expect(() => resolve({ CONVEYOR_AUTH_SECRET: SECRET })).toThrow(
      /refusing to start: CONVEYOR_PASSWORD not set/,
    );
  });

  test("refuses a 31-character secret", () => {
    expect(() => withAuth({ CONVEYOR_AUTH_SECRET: "s".repeat(31) })).toThrow(
      /CONVEYOR_AUTH_SECRET must be at least 32 characters/,
    );
  });

  test("accepts a 32-character secret", () => {
    expect(withAuth({ CONVEYOR_AUTH_SECRET: "s".repeat(32) }).enabled).toBe(true);
  });

  test("refuses an all-whitespace secret", () => {
    expect(() => withAuth({ CONVEYOR_AUTH_SECRET: " ".repeat(64) })).toThrow(
      /CONVEYOR_AUTH_SECRET must be at least 32 characters/,
    );
  });

  test("refuses a secret that is 32 characters only with padding", () => {
    expect(() => withAuth({ CONVEYOR_AUTH_SECRET: ` ${"s".repeat(31)} ` })).toThrow(
      /CONVEYOR_AUTH_SECRET must be at least 32 characters/,
    );
  });

  test("refuses an 11-character password", () => {
    expect(() => withAuth({ CONVEYOR_PASSWORD: "p".repeat(11) })).toThrow(
      /CONVEYOR_PASSWORD must be 12 to 512 characters, got 11/,
    );
  });

  test("accepts a 12-character password", () => {
    expect(withAuth({ CONVEYOR_PASSWORD: "p".repeat(12) }).enabled).toBe(true);
  });

  test("accepts a 512-character password", () => {
    expect(withAuth({ CONVEYOR_PASSWORD: "p".repeat(512) }).enabled).toBe(true);
  });

  test("refuses a 513-character password", () => {
    expect(() => withAuth({ CONVEYOR_PASSWORD: "p".repeat(513) })).toThrow(
      /CONVEYOR_PASSWORD must be 12 to 512 characters, got 513/,
    );
  });

  test("refuses an unknown CONVEYOR_AUTH value", () => {
    expect(() => resolve({ CONVEYOR_AUTH: "off" })).toThrow(AuthConfigError);
  });

  test.each(["Disabled", "DISABLED", " disabled", "disabled "])(
    "CONVEYOR_AUTH=%p is not the disabled escape hatch",
    (mode) => {
      expect(() => resolve({ CONVEYOR_AUTH: mode })).toThrow(
        /CONVEYOR_AUTH must be "enabled" or "disabled"/,
      );
    },
  );

  test("CONVEYOR_AUTH=enabled requires a password and secret", () => {
    expect(() => resolve({ CONVEYOR_AUTH: "enabled" })).toThrow(/refusing to start/);
  });

  test("enables auth when both are set", () => {
    expect(withAuth({})).toEqual({ enabled: true, password: PASSWORD, secret: SECRET });
  });

  test("CONVEYOR_AUTH=disabled turns auth off even when a password is set", () => {
    expect(resolve({ CONVEYOR_AUTH: "disabled", CONVEYOR_PASSWORD: PASSWORD })).toEqual({
      enabled: false,
      password: "",
      secret: "random-secret",
    });
  });
});

const AUTH_MODULE = join(import.meta.dir, "auth.ts");

const boot = (env: Record<string, string>) =>
  Bun.spawnSync({
    cmd: [
      process.execPath,
      "-e",
      `const m = await import(${JSON.stringify(AUTH_MODULE)}); console.log("authEnabled=" + m.authEnabled);`,
    ],
    env: { PATH: process.env.PATH ?? "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

describe("api startup", () => {
  test("exits non-zero with a clear error when auth is not configured", () => {
    const result = boot({});
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("refusing to start");
    expect(result.stdout.toString()).not.toContain("authEnabled=");
  });

  test("starts open with a loud warning when CONVEYOR_AUTH=disabled", () => {
    const result = boot({ CONVEYOR_AUTH: "disabled" });
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toContain(DISABLED_WARNING);
    expect(result.stdout.toString()).toContain("authEnabled=false");
  });

  test("starts with auth on when password and secret are set", () => {
    const result = boot({ CONVEYOR_PASSWORD: PASSWORD, CONVEYOR_AUTH_SECRET: SECRET });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("authEnabled=true");
  });
});
