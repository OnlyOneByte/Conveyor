import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AREAS, areaPath, serializeAreas } from "./comments/areas";

const REAL_ROOT = join(import.meta.dir, "..", "..");

const scratch = mkdtempSync(join(tmpdir(), "conveyor-comments-test-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const snapshot = (root: string) =>
  AREAS.map((area) => readFileSync(join(root, areaPath(area)), "utf8"));

function staleCheckout(): string {
  const root = mkdtempSync(join(scratch, "repo-"));
  mkdirSync(join(root, "scripts", "checks"), { recursive: true });
  cpSync(join(import.meta.dir, "comments.ts"), join(root, "scripts", "checks", "comments.ts"));
  cpSync(join(import.meta.dir, "comments"), join(root, "scripts", "checks", "comments"), {
    recursive: true,
    filter: (path) => path !== join(import.meta.dir, "comments", "baseline"),
  });
  mkdirSync(join(root, "scripts", "checks", "comments", "baseline"), { recursive: true });
  const stale = { files: { "a.ts": { comments: 2, suppressions: 0 } } };
  for (const [path, text] of serializeAreas(stale)) writeFileSync(join(root, path), text);
  writeFileSync(join(root, "a.ts"), "// one\nexport const a = 1;\n");
  Bun.spawnSync(["git", "init", "-q"], { cwd: root });
  Bun.spawnSync(["git", "add", "-A"], { cwd: root });
  return root;
}

describe("check:comments --update", () => {
  test("refuses to run under CI and leaves a stale baseline untouched", () => {
    const root = staleCheckout();
    const before = snapshot(root);
    const real = snapshot(REAL_ROOT);
    const result = Bun.spawnSync(
      ["bun", join(root, "scripts", "checks", "comments.ts"), "--update"],
      {
        cwd: root,
        env: { ...process.env, CI: "true" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("--update is local only");
    expect(result.stdout.toString()).not.toContain("wrote");
    expect(snapshot(root)).toEqual(before);
    expect(snapshot(REAL_ROOT)).toEqual(real);
  }, 60_000);

  test("the fixture is stale, so a broken refusal would rewrite it", () => {
    const root = staleCheckout();
    const before = snapshot(root);
    const env = { ...process.env };
    delete env.CI;
    const result = Bun.spawnSync(
      ["bun", join(root, "scripts", "checks", "comments.ts"), "--update"],
      {
        cwd: root,
        env,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain(`wrote ${areaPath("repo")}`);
    expect(snapshot(root)).not.toEqual(before);
  }, 60_000);
});
