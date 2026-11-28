import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { AuthConfigError, resolveAuthConfig, sessionTtlMs } from "./auth-config";

const DEFAULT = 12 * 60 * 60 * 1000;

describe("CONVEYOR_SESSION_TTL_MS", () => {
  test.each([
    [undefined, DEFAULT],
    ["", DEFAULT],
    ["  ", DEFAULT],
    ["1000", 1000],
    [" 3600000 ", 3_600_000],
  ])("%p gives %p ms", (raw, ms) => {
    expect(sessionTtlMs(raw)).toBe(ms);
  });

  test.each([
    "12h",
    "0",
    "999",
    "-1000",
    "1.5e6",
    "0x10000",
    "+60000",
    "1e6",
    "99999999999999999999",
  ])("refuses %p, naming the variable", (raw) => {
    expect(() => sessionTtlMs(raw)).toThrow(AuthConfigError);
    expect(() => sessionTtlMs(raw)).toThrow(
      `CONVEYOR_SESSION_TTL_MS must be a whole number of milliseconds, at least 1000, got "${raw}"`,
    );
  });

  test("is checked even with auth disabled", () => {
    expect(() =>
      resolveAuthConfig({ CONVEYOR_AUTH: "disabled", CONVEYOR_SESSION_TTL_MS: "12h" }, () => "x"),
    ).toThrow(AuthConfigError);
  });
});

const AUTH_MODULE = join(import.meta.dir, "auth.ts");
const AUTH_ENV = {
  CONVEYOR_PASSWORD: "correct-horse-battery",
  CONVEYOR_AUTH_SECRET: "a".repeat(64),
};

const boot = (ttl: string) =>
  Bun.spawnSync({
    cmd: [
      process.execPath,
      "-e",
      `const m = await import(${JSON.stringify(AUTH_MODULE)}); console.log(m.sessionCookie("t"));`,
    ],
    env: { PATH: process.env.PATH ?? "", ...AUTH_ENV, CONVEYOR_SESSION_TTL_MS: ttl },
    stdout: "pipe",
    stderr: "pipe",
  });

describe("api startup with CONVEYOR_SESSION_TTL_MS", () => {
  test("exits non-zero, naming the variable, for a value that isn't milliseconds", () => {
    const result = boot("12h");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("CONVEYOR_SESSION_TTL_MS must be a whole number");
    expect(result.stdout.toString()).toBe("");
  });

  test("sets the session cookie's Max-Age from it", () => {
    const result = boot("90000");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Max-Age=90;");
  });

  test("an empty value keeps the 12-hour default", () => {
    const result = boot("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Max-Age=43200;");
  });
});
