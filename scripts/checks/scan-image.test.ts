import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tempDirs } from "../../packages/shared/test/helpers/temp.ts";

const ROOT = realpathSync(join(import.meta.dir, "..", ".."));
const SCRIPT = join(import.meta.dir, "scan-image.sh");
const PINNED = /(^| )aquasec\/trivy@sha256:[0-9a-f]{64} /;
const dirs = tempDirs("conveyor-scan-image-");

type Fails = "nothing" | "scan" | "db";

const FAKE_DOCKER = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_CALLS"
case "$FAKE_FAILS:$*" in
  db:*--download-db-only*) exit 1 ;;
  scan:*--exit-code*) exit 1 ;;
esac
`;

interface Run {
  cache?: string;
  fails?: Fails;
  script?: string;
}

async function runWithFakeDocker({
  cache = "cache/trivy",
  fails = "nothing",
  script = SCRIPT,
}: Run) {
  const dir = realpathSync(await dirs());
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const calls = join(dir, "calls.txt");
  writeFileSync(join(bin, "docker"), FAKE_DOCKER);
  writeFileSync(join(bin, "sleep"), "#!/usr/bin/env bash\n");
  chmodSync(join(bin, "docker"), 0o755);
  chmodSync(join(bin, "sleep"), 0o755);
  const run = Bun.spawnSync(["bash", script, "conveyor-api"], {
    cwd: dir,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TRIVY_CACHE: cache,
      HOME: dir,
      GITHUB_STEP_SUMMARY: "",
      FAKE_CALLS: calls,
      FAKE_FAILS: fails,
    },
  });
  const made = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [];
  return { dir, code: run.exitCode, calls: made, stderr: run.stderr.toString() };
}

describe("scan-image.sh passes only a clean scan", () => {
  test("a clean scan exits 0, mounting the repo's allowlist and gating on fixed HIGH and CRITICAL", async () => {
    const { dir, code, calls } = await runWithFakeDocker({});
    expect(code).toBe(0);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call).toContain(`-v ${dir}/cache/trivy:/root/.cache/trivy`);
      expect(call).toContain(`-v ${ROOT}/.github/image-scan-allowlist.yaml:/allowlist.yaml:ro`);
    }
    expect(calls[2]).toContain("--ignorefile /allowlist.yaml");
    expect(calls[2]).toContain("--severity CRITICAL,HIGH");
    expect(calls[2]).toContain("--ignore-unfixed");
    expect(calls[2]).toContain("--exit-code 1");
  });

  test("every Trivy run uses an image pinned by digest, never a tag", async () => {
    const { calls } = await runWithFakeDocker({});
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(PINNED);
  });

  test("an absolute TRIVY_CACHE is used as given", async () => {
    const absolute = join(await dirs(), "abs-cache");
    const { calls } = await runWithFakeDocker({ cache: absolute });
    expect(calls[0]).toContain(`-v ${absolute}:/root/.cache/trivy`);
  });
});

describe("scan-image.sh fails closed", () => {
  test("a scan that finds something exits non-zero and names the allowlist", async () => {
    const { code, calls, stderr } = await runWithFakeDocker({ fails: "scan" });
    expect(code).not.toBe(0);
    expect(calls).toHaveLength(3);
    expect(stderr).toContain("doesn't accept");
  });

  test("a database download that keeps failing exits non-zero after three tries, without scanning", async () => {
    const { code, calls } = await runWithFakeDocker({ fails: "db" });
    expect(code).not.toBe(0);
    expect(calls.filter((call) => call.includes("--download-db-only"))).toHaveLength(3);
    expect(calls.filter((call) => call.includes("--exit-code"))).toEqual([]);
  });

  test("a missing allowlist exits non-zero before running Trivy", async () => {
    const tree = realpathSync(await dirs());
    mkdirSync(join(tree, "scripts", "checks"), { recursive: true });
    const copy = join(tree, "scripts", "checks", "scan-image.sh");
    copyFileSync(SCRIPT, copy);
    const { code, calls, stderr } = await runWithFakeDocker({ script: copy });
    expect(code).not.toBe(0);
    expect(calls).toEqual([]);
    expect(stderr).toContain(`no allowlist at ${tree}/.github/image-scan-allowlist.yaml`);
  });
});
