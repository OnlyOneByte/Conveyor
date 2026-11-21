import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { AuthConfigError, DISABLED_WARNING, resolveAuthConfig } from "./auth-config";

const SECRET = "a".repeat(64);
const random = () => "random-secret";

describe("resolveAuthConfig", () => {
  test("refuses to start with no password and no secret", () => {
    expect(() => resolveAuthConfig({}, random)).toThrow(
      /refusing to start: CONVEYOR_PASSWORD and CONVEYOR_AUTH_SECRET not set/,
    );
  });

  test("refuses to start with a password but no secret", () => {
    expect(() => resolveAuthConfig({ CONVEYOR_PASSWORD: "pw" }, random)).toThrow(
      /refusing to start: CONVEYOR_AUTH_SECRET not set/,
    );
  });

  test("refuses to start with a secret but no password", () => {
    expect(() => resolveAuthConfig({ CONVEYOR_AUTH_SECRET: SECRET }, random)).toThrow(
      /refusing to start: CONVEYOR_PASSWORD not set/,
    );
  });

  test("refuses a short secret", () => {
    expect(() =>
      resolveAuthConfig({ CONVEYOR_PASSWORD: "pw", CONVEYOR_AUTH_SECRET: "short" }, random),
    ).toThrow(/at least 32 characters/);
  });

  test("refuses an unknown CONVEYOR_AUTH value", () => {
    expect(() => resolveAuthConfig({ CONVEYOR_AUTH: "off" }, random)).toThrow(AuthConfigError);
  });

  test("enables auth when both are set", () => {
    expect(
      resolveAuthConfig({ CONVEYOR_PASSWORD: "pw", CONVEYOR_AUTH_SECRET: SECRET }, random),
    ).toEqual({ enabled: true, password: "pw", secret: SECRET });
  });

  test("CONVEYOR_AUTH=disabled turns auth off even when a password is set", () => {
    expect(
      resolveAuthConfig({ CONVEYOR_AUTH: "disabled", CONVEYOR_PASSWORD: "pw" }, random),
    ).toEqual({ enabled: false, password: "", secret: "random-secret" });
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
    const result = boot({ CONVEYOR_PASSWORD: "pw", CONVEYOR_AUTH_SECRET: SECRET });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("authEnabled=true");
  });
});
